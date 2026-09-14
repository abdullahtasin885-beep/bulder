// GitHub / Vercel Serverless Function: api/index.js

const MAIN_BOT_TOKEN = "8809628706:AAE3U53e12KGbyMBmZQqmg-NmaCzGPCdg18";
const SUPER_ADMIN = 8045367594;
const FIREBASE_DB = "https://bkas-45e17-default-rtdb.firebaseio.com";

// Helper: Telegram API Request
async function tgRequest(token, method, data = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    console.error(`Telegram ${method} Error:`, err);
    return null;
  }
}

// Helper: Firebase REST API
async function dbGet(path) {
  try {
    const res = await fetch(`${FIREBASE_DB}/${path}.json`);
    return await res.json();
  } catch (err) {
    console.error("Firebase Get Error:", err);
    return null;
  }
}

async function dbSet(path, data) {
  try {
    const res = await fetch(`${FIREBASE_DB}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err) {
    console.error("Firebase Set Error:", err);
    return null;
  }
}

async function dbDelete(path) {
  try {
    await fetch(`${FIREBASE_DB}/${path}.json`, { method: "DELETE" });
  } catch (err) {
    console.error("Firebase Delete Error:", err);
  }
}

// Main Vercel Serverless Handler
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot Webhook is Live!");
  }

  // Token: can come from query param (for connected bots) or default to MAIN_BOT_TOKEN
  const currentToken = req.query?.token || MAIN_BOT_TOKEN;
  const currentBotId = currentToken.split(":")[0];
  const isMainBot = currentToken === MAIN_BOT_TOKEN;

  const update = req.body;
  if (!update) return res.status(200).send("No update");

  // Host URL detection for Webhooks
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `https://${host}/api`;

  // Standard Reply for Users (Bot Off Notice)
  const defaultOffText = `⛔ Bot currently off!\n🔧 Source: SΛKIB 〆 DΞVΞLOPΞR\nSupport: @AuraSupportsBot`;
  const defaultButtons = {
    inline_keyboard: [
      [
        {
          text: "🔧 Source: SΛKIB 〆 DΞVΞLOPΞR",
          url: "https://t.me/Sakib_Developer1",
        },
      ],
      [
        {
          text: "Support: @AuraSupportsBot",
          url: "https://t.me/AuraSupportsBot",
        },
      ],
    ],
  };

  // ---------------- Handle Callback Queries (Admin Button Clicks) ----------------
  if (update.callback_query) {
    const cb = update.callback_query;
    const adminId = cb.from.id;
    const data = cb.data;

    if (adminId !== SUPER_ADMIN || !isMainBot) {
      await tgRequest(currentToken, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "⛔ Unauthorized Access!",
        show_alert: true,
      });
      return res.status(200).send("OK");
    }

    await tgRequest(currentToken, "answerCallbackQuery", { callback_query_id: cb.id });

    // Panel Menu Actions
    if (data === "admin_menu") {
      await sendAdminPanel(currentToken, adminId, cb.message.message_id);
    } else if (data === "add_bot") {
      await dbSet(`admin_state`, { step: "WAITING_BOT_TOKEN" });
      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: "📥 আপনি যে বটটি কানেক্ট করতে চান তার **Bot Token** পাঠান:\n\n(বাতিল করতে /cancel লিখুন)",
        parse_mode: "Markdown",
      });
    } else if (data === "list_bots") {
      const bots = (await dbGet("bots")) || {};
      let msg = "📋 **কানেক্টেড বট তালিকা:**\n\n";
      const keys = Object.keys(bots);
      if (keys.length === 0) {
        msg += "⚠️ বর্তমানে কোনো অতিরিক্ত বট কানেক্ট করা নেই।";
      } else {
        for (const [id, bot] of Object.entries(bots)) {
          const userCount = bot.users ? Object.keys(bot.users).length : 0;
          msg += `🤖 @${bot.username || "Unknown"} (ID: \`${id}\`)\n👥 ইউজার: ${userCount}\n\n`;
        }
      }
      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: msg,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 ব্যাক", callback_data: "admin_menu" }]],
        },
      });
    } else if (data === "remove_bot_list") {
      const bots = (await dbGet("bots")) || {};
      const buttons = [];
      for (const [id, bot] of Object.entries(bots)) {
        buttons.push([
          {
            text: `❌ Delete @${bot.username || id}`,
            callback_data: `del_bot_${id}`,
          },
        ]);
      }
      buttons.push([{ text: "🔙 ব্যাক", callback_data: "admin_menu" }]);

      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: "⚠️ কোন বটটি রিমুভ করতে চান সিলেক্ট করুন:",
        reply_markup: { inline_keyboard: buttons },
      });
    } else if (data.startsWith("del_bot_")) {
      const removeId = data.replace("del_bot_", "");
      const bot = await dbGet(`bots/${removeId}`);
      if (bot && bot.token) {
        // Webhook remove
        await tgRequest(bot.token, "deleteWebhook");
      }
      await dbDelete(`bots/${removeId}`);
      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: `✅ বটটি ডাটাবেজ এবং ওয়েবহুক থেকে মুছে ফেলা হয়েছে!`,
      });
      await sendAdminPanel(currentToken, adminId);
    } else if (data === "bc_single_select") {
      const bots = (await dbGet("bots")) || {};
      const buttons = [
        [{ text: `📢 Main Bot (@AuraStarPayBot)`, callback_data: `bc_bot_${MAIN_BOT_TOKEN.split(":")[0]}` }]
      ];
      for (const [id, bot] of Object.entries(bots)) {
        buttons.push([
          {
            text: `📢 @${bot.username || id}`,
            callback_data: `bc_bot_${id}`,
          },
        ]);
      }
      buttons.push([{ text: "🔙 ব্যাক", callback_data: "admin_menu" }]);
      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: "🎯 যে বটে ব্রডকাস্ট করতে চান তা বেছে নিন:",
        reply_markup: { inline_keyboard: buttons },
      });
    } else if (data.startsWith("bc_bot_")) {
      const targetId = data.replace("bc_bot_", "");
      await dbSet(`admin_state`, { step: "WAITING_SINGLE_BC", targetBotId: targetId });
      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: `📝 বট ID: \`${targetId}\` এর জন্য ব্রডকাস্ট মেসেজটি লিখে পাঠান:\n\n(বাতিল করতে /cancel লিখুন)`,
        parse_mode: "Markdown",
      });
    } else if (data === "bc_all") {
      await dbSet(`admin_state`, { step: "WAITING_ALL_BC" });
      await tgRequest(currentToken, "sendMessage", {
        chat_id: adminId,
        text: "🌐 **অল বট ব্রডকাস্ট:**\nসবগুলো কানেক্টেড বটের ইউজারদের কাছে পাঠানোর জন্য মেসেজটি লিখে পাঠান:\n\n(বাতিল করতে /cancel লিখুন)",
        parse_mode: "Markdown",
      });
    }

    return res.status(200).send("OK");
  }

  // ---------------- Handle Messages ----------------
  const message = update.message;
  if (!message) return res.status(200).send("No message");

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";

  // ১. প্রতি বটের আলাদা ফোল্ডারে ইউজার সেভ করা (/bots/<currentBotId>/users/<userId>)
  await dbSet(`bots/${currentBotId}/users/${userId}`, {
    id: userId,
    first_name: message.from.first_name || "",
    username: message.from.username || "",
    last_active: Date.now(),
  });

  // ২. যদি সুপার এডমিন মেইন বটে কমান্ড দেয়
  if (userId === SUPER_ADMIN && isMainBot) {
    if (text === "/start" || text === "/admin") {
      await sendAdminPanel(currentToken, chatId);
      return res.status(200).send("OK");
    }

    if (text === "/cancel") {
      await dbDelete(`admin_state`);
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "❌ অপারেশন বাতিল করা হয়েছে।",
      });
      await sendAdminPanel(currentToken, chatId);
      return res.status(200).send("OK");
    }

    // এডমিন ইনপুট হ্যান্ডলার (State Check)
    const adminState = await dbGet("admin_state");
    if (adminState && adminState.step) {
      // বট যুক্ত করা
      if (adminState.step === "WAITING_BOT_TOKEN") {
        const inputToken = text.trim();
        const testBot = await tgRequest(inputToken, "getMe");

        if (!testBot || !testBot.ok) {
          await tgRequest(currentToken, "sendMessage", {
            chat_id: chatId,
            text: "❌ ভুল টোকেন! দয়া করে সঠিক Bot Token দিন অথবা /cancel লিখুন।",
          });
          return res.status(200).send("OK");
        }

        const newBot = testBot.result;
        const newBotWebhook = `${baseUrl}?token=${inputToken}`;
        await tgRequest(inputToken, "setWebhook", { url: newBotWebhook });

        // Firebase-এ সংরক্ষণ
        await dbSet(`bots/${newBot.id}/info`, {
          id: newBot.id,
          username: newBot.username,
          first_name: newBot.first_name,
          token: inputToken,
          connected_at: Date.now(),
        });

        await dbDelete("admin_state");
        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `🎉 সফল হয়েছে!\nবট: @${newBot.username}\nID: \`${newBot.id}\`\nওয়েবহুক অটোমেটিক সেট হয়ে কানেক্ট হয়ে গেছে।`,
          parse_mode: "Markdown",
        });
        await sendAdminPanel(currentToken, chatId);
        return res.status(200).send("OK");
      }

      // সিঙ্গেল বট ব্রডকাস্ট
      if (adminState.step === "WAITING_SINGLE_BC") {
        const targetBotId = adminState.targetBotId;
        let targetToken = currentToken;

        if (targetBotId !== currentBotId) {
          const targetBot = await dbGet(`bots/${targetBotId}/info`);
          if (targetBot && targetBot.token) {
            targetToken = targetBot.token;
          }
        }

        const users = (await dbGet(`bots/${targetBotId}/users`)) || {};
        const userIds = Object.keys(users);

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `⏳ ব্রডকাস্ট শুরু হয়েছে মোট ${userIds.length} জন ইউজারের কাছে...`,
        });

        let success = 0;
        let fail = 0;
        for (const uId of userIds) {
          const res = await tgRequest(targetToken, "copyMessage", {
            chat_id: uId,
            from_chat_id: chatId,
            message_id: message.message_id,
          });
          if (res && res.ok) success++;
          else fail++;
        }

        await dbDelete("admin_state");
        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `✅ ব্রডকাস্ট সম্পন্ন!\nসফল: ${success}\nব্যর্থ: ${fail}`,
        });
        return res.status(200).send("OK");
      }

      // অল বট ব্রডকাস্ট
      if (adminState.step === "WAITING_ALL_BC") {
        const allBots = (await dbGet("bots")) || {};
        // Main Bot সহ সমস্ত বটের তালিকা
        const botList = [{ id: currentBotId, token: MAIN_BOT_TOKEN }];
        for (const [bId, bData] of Object.entries(allBots)) {
          if (bData.info && bData.info.token && bId !== currentBotId) {
            botList.push({ id: bId, token: bData.info.token });
          }
        }

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `⏳ মোট ${botList.length} টি বটের সমস্ত ইউজারের কাছে ব্রডকাস্ট শুরু হচ্ছে...`,
        });

        let totalSuccess = 0;
        let totalFail = 0;

        for (const b of botList) {
          const users = (await dbGet(`bots/${b.id}/users`)) || {};
          for (const uId of Object.keys(users)) {
            const res = await tgRequest(b.token, "copyMessage", {
              chat_id: uId,
              from_chat_id: chatId,
              message_id: message.message_id,
            });
            if (res && res.ok) totalSuccess++;
            else totalFail++;
          }
        }

        await dbDelete("admin_state");
        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `🎉 অল বট ব্রডকাস্ট সম্পন্ন!\nমোট সফল: ${totalSuccess}\nমোট ব্যর্থ: ${totalFail}`,
        });
        return res.status(200).send("OK");
      }
    }
  }

  // ৩. সাধারণ ইউজারদের জন্য নির্ধারিত মেসেজ ও বাটন
  await tgRequest(currentToken, "sendMessage", {
    chat_id: chatId,
    text: defaultOffText,
    reply_markup: defaultButtons,
  });

  return res.status(200).send("OK");
}

// Helper: এডমিন প্যানেল মেনু
async function sendAdminPanel(token, chatId, messageId = null) {
  const panelText =
    `👑 **সুপার এডমিন কন্ট্রোল প্যানেল**\n\n` +
    `বট ম্যানেজ এবং ব্রডকাস্ট করার অপশনগুলো নিচে দেওয়া হলো:`;

  const panelKeyboard = {
    inline_keyboard: [
      [
        { text: "➕ Add Bot", callback_data: "add_bot" },
        { text: "➖ Remove Bot", callback_data: "remove_bot_list" },
      ],
      [{ text: "📋 Bot List & Stats", callback_data: "list_bots" }],
      [
        { text: "📢 Single Bot Broadcast", callback_data: "bc_single_select" },
      ],
      [{ text: "🌐 All Bots Broadcast", callback_data: "bc_all" }],
    ],
  };

  if (messageId) {
    await tgRequest(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: panelText,
      parse_mode: "Markdown",
      reply_markup: panelKeyboard,
    });
  } else {
    await tgRequest(token, "sendMessage", {
      chat_id: chatId,
      text: panelText,
      parse_mode: "Markdown",
      reply_markup: panelKeyboard,
    });
  }
}
