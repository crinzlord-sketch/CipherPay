import { Router, type IRouter } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import ethers from "../vendor/ethers.umd.min.cjs";
const { Wallet, JsonRpcProvider, Contract, formatUnits, formatEther, parseUnits, parseEther, isAddress } = ethers as any;
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

type Network = "ethereum" | "base" | "bsc" | "polygon";
const NETWORKS: Record<Network, { chainId:number; rpc:string; native:string; explorer:string }> = {
  ethereum: { chainId:1, rpc:process.env.CRYPTO_ETH_RPC || "https://ethereum-rpc.publicnode.com", native:"ETH", explorer:"https://etherscan.io/tx/" },
  base: { chainId:8453, rpc:process.env.CRYPTO_BASE_RPC || "https://base-rpc.publicnode.com", native:"ETH", explorer:"https://basescan.org/tx/" },
  bsc: { chainId:56, rpc:process.env.CRYPTO_BSC_RPC || "https://bsc-rpc.publicnode.com", native:"BNB", explorer:"https://bscscan.com/tx/" },
  polygon: { chainId:137, rpc:process.env.CRYPTO_POLYGON_RPC || "https://polygon-bor-rpc.publicnode.com", native:"POL", explorer:"https://polygonscan.com/tx/" },
};

const TOKENS: Record<string, { address:string; decimals:number; networks:Network[] }> = {
  USDC: { address:"0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals:6, networks:["ethereum"] },
  "USDC:base": { address:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals:6, networks:["base"] },
  USDT: { address:"0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals:6, networks:["ethereum"] },
  "USDT:bsc": { address:"0x55d398326f99059fF775485246999027B3197955", decimals:18, networks:["bsc"] },
  "USDC:bsc": { address:"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals:18, networks:["bsc"] },
  "USDC:polygon": { address:"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals:6, networks:["polygon"] },
  "USDT:polygon": { address:"0xc2132D05D31c914a87C6611C10748AaCbA0F3b9f", decimals:6, networks:["polygon"] },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
];

const getUserId = (req:any) => {
  const raw = req.headers["x-user-id"];
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const encryptionKey = () => {
  const source = process.env.CRYPTO_WALLET_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) throw new Error("Crypto wallet encryption key is not configured");
  return createHash("sha256").update(source).digest();
};

const encrypt = (value:string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return iv.toString("base64url") + "." + cipher.getAuthTag().toString("base64url") + "." + ciphertext.toString("base64url");
};

const decrypt = (value:string) => {
  const [ivRaw, tagRaw, dataRaw] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
};

const ensureTables = async () => {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS crypto_wallets (
    id serial PRIMARY KEY,
    user_id integer NOT NULL UNIQUE,
    address text NOT NULL,
    encrypted_private_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS crypto_transactions (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    network text NOT NULL,
    asset text NOT NULL,
    direction text NOT NULL,
    amount numeric(30, 18) NOT NULL,
    to_address text,
    tx_hash text NOT NULL,
    status text NOT NULL DEFAULT 'submitted',
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
};

const getWallet = async (userId:number) => {
  const result = await db.execute(sql`SELECT id, user_id, address, encrypted_private_key FROM crypto_wallets WHERE user_id = ${userId} LIMIT 1`);
  return (result.rows[0] as any) || null;
};

const createWallet = async (userId:number) => {
  const existing = await getWallet(userId);
  if (existing) return existing;

  // Generate the private key with Node's CSPRNG instead of ethers' browser-oriented
  // random source. This avoids cold-start/runtime crypto issues on Render.
  let wallet: Wallet;
  for (;;) {
    try {
      wallet = new Wallet("0x" + randomBytes(32).toString("hex"));
      break;
    } catch {
      // Extremely unlikely invalid secp256k1 key; generate another 32-byte value.
    }
  }

  await db.execute(sql`INSERT INTO crypto_wallets (user_id,address,encrypted_private_key) VALUES (${userId},${wallet.address},${encrypt(wallet.privateKey)}) ON CONFLICT (user_id) DO NOTHING`);
  return getWallet(userId);
};

const providerFor = (network:Network) => new JsonRpcProvider(NETWORKS[network].rpc, NETWORKS[network].chainId, { staticNetwork:true });

async function balances(address:string) {
  const networks = Object.keys(NETWORKS) as Network[];
  const settled = await Promise.all(networks.map(async network => {
    const cfg = NETWORKS[network];
    const provider = providerFor(network);
    try {
      const nativePromise = provider.getBalance(address);
      const tokenPromises = Object.entries(TOKENS)
        .filter(([, token]) => token.networks.includes(network))
        .map(async ([key, token]) => {
          const symbol = key.split(":")[0];
          const contract = new Contract(token.address, ERC20_ABI, provider);
          const raw = await contract.balanceOf(address);
          return { network, asset:symbol, balance:Number(formatUnits(raw, token.decimals)), address, type:"token", tokenAddress:token.address };
        });
      const native = await nativePromise;
      return [{ network, asset:cfg.native, balance:Number(formatEther(native)), address, type:"native" }, ...(await Promise.all(tokenPromises))];
    } catch (error) {
      console.warn("[crypto] balance refresh failed", network, error);
      return [];
    }
  }));
  return settled.flat();
}

router.get("/crypto/wallet", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  try {
    await ensureTables();
    const wallet = await createWallet(userId);
    // Address creation is kept independent from slow public RPC calls so Receive
    // never waits for blockchain balance providers to wake up.
    res.json({ address:wallet.address, balances:[], networks:Object.entries(NETWORKS).map(([id,v])=>({id,chainId:v.chainId,native:v.native,explorer:v.explorer})) });
  } catch (error:any) {
    console.error("[crypto/wallet] request failed", error?.stack || error);
    res.status(500).json({error:error?.message || "Crypto wallet unavailable"});
  }
});

router.get("/crypto/balances", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  try {
    await ensureTables();
    const wallet = await createWallet(userId);
    const items = await balances(wallet.address);
    res.json({ address:wallet.address, balances:items });
  } catch (error:any) {
    console.error("[crypto/balances] request failed", error?.stack || error);
    res.status(500).json({error:error?.message || "Crypto balances unavailable"});
  }
});

router.get("/crypto/transactions", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  await ensureTables();
  const result = await db.execute(sql`SELECT id,network,asset,direction,amount,to_address,tx_hash,status,created_at FROM crypto_transactions WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 50`);
  const rows = result.rows as any[];
  for (const row of rows) {
    if (!row.tx_hash || row.status === "confirmed" || row.status === "failed") continue;
    try {
      const networkName = String(row.network) as Network;
      if (!(networkName in NETWORKS)) continue;
      const receipt = await providerFor(networkName).getTransactionReceipt(String(row.tx_hash));
      if (!receipt) continue;
      const nextStatus = Number(receipt.status) === 1 ? "confirmed" : "failed";
      await db.execute(sql`UPDATE crypto_transactions SET status=${nextStatus} WHERE id=${Number(row.id)} AND user_id=${userId}`);
      row.status = nextStatus;
    } catch (error) {
      console.warn("[crypto] transaction status refresh failed", row.tx_hash, error);
    }
  }
  res.json({transactions:rows});
});

router.post("/crypto/send", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  const network = String(req.body?.network || "") as Network;
  const asset = String(req.body?.asset || "").toUpperCase();
  const to = String(req.body?.to || "").trim();
  const amount = Number(req.body?.amount);
  if (!(network in NETWORKS) || !to || !isAddress(to) || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({error:"Enter a valid network, destination address and amount."}); return;
  }

  await ensureTables();
  const stored = await getWallet(userId);
  if (!stored) { res.status(404).json({error:"Crypto wallet not found."}); return; }

  try {
    const provider = providerFor(network);
    const signer = new Wallet(decrypt(stored.encrypted_private_key), provider);
    let tx:any;
    let decimals = 18;
    const tokenKey = asset === "ETH" || asset === "BNB" || asset === "POL" ? "" : asset + (network === "base" ? ":base" : network === "bsc" ? ":bsc" : network === "polygon" ? ":polygon" : "");
    const token = TOKENS[tokenKey];
    if (token) {
      decimals = token.decimals;
      const contract = new Contract(token.address, ERC20_ABI, signer);
      tx = await contract.transfer(to, parseUnits(String(amount), decimals));
    } else {
      if (asset !== NETWORKS[network].native) { res.status(400).json({error:`{asset} is not supported on {network} yet.`.replace("{asset}",asset).replace("{network}",network)}); return; }
      tx = await signer.sendTransaction({to,value:parseEther(String(amount))});
    }
    await db.execute(sql`INSERT INTO crypto_transactions (user_id,network,asset,direction,amount,to_address,tx_hash,status) VALUES (${userId},${network},${asset},'outgoing',${String(amount)},${to},${tx.hash},'submitted')`);
    res.json({status:"submitted",txHash:tx.hash,explorer:NETWORKS[network].explorer + tx.hash});
  } catch (error:any) {
    res.status(502).json({error:error?.shortMessage || error?.reason || error?.message || "Blockchain transaction failed"});
  }
});

export default router;
