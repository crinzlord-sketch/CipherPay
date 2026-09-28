import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// A CipherPay account number is a 10-digit string whose first digit is non-zero,
// so it never collides with a leading-zero phone number and is easy to read aloud.
function gen(): string {
  return (
    String(Math.floor(1 + Math.random() * 9)) +
    Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("")
  );
}

export async function generateUniqueAccountNumber(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const candidate = gen();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.accountNumber, candidate));
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a unique account number");
}
