import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendUserNotificationEmail, isEmailConfigured } from "./email";
import { logger } from "./logger";

export interface NotifyArgs {
  userId: number;
  title: string;
  body: string;
  type?: "info" | "success" | "warning" | "error" | "admin" | "transaction" | "admin_kyc" | "admin_support" | "admin_seller" | "admin_gift_card";
  link?: string | null;
  email?: boolean;
}

// Sends an Expo push notification to a device token.
// Uses Expo's public push API — no server key required for Expo-hosted tokens.
async function sendExpoPush(expoPushToken: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (!expoPushToken.startsWith("ExponentPushToken[")) return;
  try {
    const payload = {
      to: expoPushToken,
      sound: "default",
      title,
      body,
      data: data ?? {},
      priority: "high",
      channelId: "default",
    };
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      logger.warn({ expoPushToken: expoPushToken.slice(0, 30), status: res.status, txt }, "expo push send failed");
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, "expo push send threw");
  }
}

export async function notifyUser(args: NotifyArgs): Promise<void> {
  const { userId, title, body, type = "info", link = null, email = false } = args;
  try {
    await db.insert(notificationsTable).values({ userId, title, body, type, link: link ?? null });
  } catch (e: any) {
    logger.warn({ err: e?.message, userId }, "notification insert failed");
  }

  // Parallel: email + Expo push
  const tasks: Promise<void>[] = [];

  if (email && isEmailConfigured()) {
    tasks.push(
      (async () => {
        try {
          const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
          if (u?.email) await sendUserNotificationEmail(u.email, title, body);
        } catch (e: any) {
          logger.warn({ err: e?.message, userId }, "notification email failed");
        }
      })(),
    );
  }

  // Always attempt Expo push if the user has a token
  tasks.push(
    (async () => {
      try {
        const [u] = await db.select({ expoPushToken: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, userId));
        if (u?.expoPushToken) await sendExpoPush(u.expoPushToken, title, body, { link: link ?? undefined });
      } catch (e: any) {
        logger.warn({ err: e?.message, userId }, "expo push lookup failed");
      }
    })(),
  );

  await Promise.allSettled(tasks);
}
