import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ethers = require("../vendor/ethers.umd.min.js") as any;
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

type Network = "ethereum" | "base" | "bsc";
const NETWORKS: Record<Network, { chainId:number; rpc:string; native:string; explorer:string }> = {
  ethereum: { chainId:1, rpc:process.env.CRYPTO_ETH_RPC || "https://ethereum-rpc.publicnode.com", native:"ETH", explorer:"https://etherscan.io/tx/" },
  base: { chainId:8453, rpc:process.env.CRYPTO_BASE_RPC || "https://base-rpc.publicnode.com", native:"ETH", explorer:"https://basescan.org/tx/" },
  bsc: { chainId:56, rpc:process.env.CRYPTO_BSC_RPC || "https://bsc-rpc.publicnode.com", native:"BNB", explorer:"https://bscscan.com/tx/" },
};

const TOKENS: Record<string, { address:string; decimals:number; networks:Network[] }> = {
  USDC: {
    address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6,
    networks: ["ethereum"],
  },
  "USDC:base": {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    networks: ["base"],
  },
  USDT: {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    networks: ["ethereum"],
  },
  "USDT:bsc": {
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    networks: ["bsc"],
  },
  "USDC:bsc": {
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    networks: ["bsc"],
  },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
];

const getUserId = (req: any) => {
  const raw = req.headers["x-user-id"];
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const encryptionKey = () => {
  const source = process.env.CRYPTO_WALLET_ENCRYPTION_KEY || process.env.JWT_SECRET;
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
  const wallet = ethers.Wallet.createRandom();
  await db.execute(sql`INSERT INTO crypto_wallets (user_id,address,encrypted_private_key) VALUES (${userId},${wallet.address},${encrypt(wallet.privateKey)}) ON CONFLICT (user_id) DO NOTHING`);
  return getWallet(userId);
};

const providerFor = (network:Network) => new ethers.JsonRpcProvider(NETWORKS[network].rpc, NETWORKS[network].chainId, { staticNetwork:true });

async function balances(address:string) {
  const result:any[] = [];
  for (const network of Object.keys(NETWORKS) as Network[]) {
    const cfg = NETWORKS[network];
    const provider = providerFor(network);
    try {
      const native = await provider.getBalance(address);
      result.push({ network, asset:cfg.native, balance:Number(ethers.formatEther(native)), address, type:"native" });
      for (const [key, token] of Object.entries(TOKENS)) {
        if (!token.networks.includes(network)) continue;
        const symbol = key.split(":")[0];
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
        const raw = await contract.balanceOf(address);
        result.push({ network, asset:symbol, balance:Number(ethers.formatUnits(raw, token.decimals)), address, type:"token", tokenAddress:token.address });
      }
    } catch (error) {
      console.warn("[crypto] balance refresh failed", network, error);
    }
  }
  return result;
}

router.get("/crypto/wallet", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  try {
    await ensureTables();
    const wallet = await createWallet(userId);
    const items = await balances(wallet.address);
    res.json({ address:wallet.address, balances:items, networks:Object.entries(NETWORKS).map(([id,v])=>({id,chainId:v.chainId,native:v.native,explorer:v.explorer})) });
  } catch (error:any) {
    res.status(500).json({error:error?.message || "Crypto wallet unavailable"});
  }
});

router.get("/crypto/transactions", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  await ensureTables();
  const result = await db.execute(sql`SELECT id,network,asset,direction,amount,to_address,tx_hash,status,created_at FROM crypto_transactions WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 50`);
  res.json({transactions:result.rows});
});

router.post("/crypto/send", async (req,res):Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({error:"Unauthorized"}); return; }
  const network = String(req.body?.network || "") as Network;
  const asset = String(req.body?.asset || "").toUpperCase();
  const to = String(req.body?.to || "").trim();
  const amount = Number(req.body?.amount);
  const pin = String(req.body?.pin || "");
  if (!(network in NETWORKS) || !to || !ethers.isAddress(to) || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({error:"Enter a valid network, destination address and amount."}); return;
  }
  if (!/^\d{4}$/.test(pin)) { res.status(400).json({error:"Enter your 4-digit transfer PIN."}); return; }
  const [user] = await db.select({pinHash:usersTable.pinHash}).from(usersTable).where(eq(usersTable.id,userId));
  if (!user?.pinHash || !(await bcrypt.compare(pin,user.pinHash))) { res.status(401).json({error:"Incorrect transfer PIN."}); return; }

  await ensureTables();
  const stored = await getWallet(userId);
  if (!stored) { res.status(404).json({error:"Crypto wallet not found."}); return; }

  try {
    const provider = providerFor(network);
    const signer = new ethers.Wallet(decrypt(stored.encrypted_private_key), provider);
    let tx:any;
    let decimals = 18;
    const tokenKey = asset === "ETH" || asset === "BNB" ? "" : asset + (network === "base" ? ":base" : network === "bsc" ? ":bsc" : "");
    const token = TOKENS[tokenKey];
    if (token) {
      decimals = token.decimals;
      const contract = new ethers.Contract(token.address, ERC20_ABI, signer);
      tx = await contract.transfer(to, ethers.parseUnits(String(amount), decimals));
    } else {
      if (asset !== NETWORKS[network].native) { res.status(400).json({error:`{asset} is not supported on {network} yet.`.replace("{asset}",asset).replace("{network}",network)}); return; }
      tx = await signer.sendTransaction({to,value:ethers.parseEther(String(amount))});
    }
    await db.execute(sql`INSERT INTO crypto_transactions (user_id,network,asset,direction,amount,to_address,tx_hash,status) VALUES (${userId},${network},${asset},'outgoing',${String(amount)},${to},${tx.hash},'submitted')`);
    res.json({status:"submitted",txHash:tx.hash,explorer:NETWORKS[network].explorer + tx.hash});
  } catch (error:any) {
    res.status(502).json({error:error?.shortMessage || error?.reason || error?.message || "Blockchain transaction failed"});
  }
});

export default router;
