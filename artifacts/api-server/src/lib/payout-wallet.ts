import { db, walletsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createPayoutWallet, fetchPayoutStaticAccount } from "./flutterwave";

export async function ensureUserPayoutWallet(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new Error("User not found");

  let [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId));
  if (!wallet) {
    [wallet] = await db.insert(walletsTable).values({ userId, balance: "0", ledgerBalance: "0", currency: "NGN" }).returning();
  }

  let accountReference = wallet.flwPsaAccountReference;
  let barterId = wallet.flwPsaBarterId;
  let psaId = wallet.flwPsaId;
  let bankName = wallet.flwPsaBankName;
  let bankCode = wallet.flwPsaBankCode;

  if (!accountReference) {
    const psa = await createPayoutWallet({
      accountName: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      phone: user.phone,
    });
    accountReference = psa.accountReference;
    barterId = psa.barterId;
    psaId = psa.id || null;
    bankName = psa.bankName;
    bankCode = psa.bankCode;

    [wallet] = await db.update(walletsTable)
      .set({
        flwPsaId: psaId,
        flwPsaAccountReference: accountReference,
        flwPsaBarterId: barterId,
        flwPsaBankName: bankName,
        flwPsaBankCode: bankCode,
      })
      .where(eq(walletsTable.userId, userId))
      .returning();
  }

  if (!wallet.flwPsaStaticAccount) {
    const account = await fetchPayoutStaticAccount(accountReference);
    [wallet] = await db.update(walletsTable)
      .set({
        flwPsaStaticAccount: account.accountNumber,
        flwPsaBankName: account.bankName,
        flwPsaBankCode: account.bankCode,
      })
      .where(eq(walletsTable.userId, userId))
      .returning();
  }

  return {
    user,
    wallet,
    accountReference,
    barterId,
    psaId,
    accountNumber: wallet.flwPsaStaticAccount!,
    bankName: wallet.flwPsaBankName ?? bankName ?? "Flutterwave",
    bankCode: wallet.flwPsaBankCode ?? bankCode ?? "",
  };
}
