import express from "express";

const app = express();
app.use(express.json());

// কনফিগারেশন
const MAIN_BOT_TOKEN = "8809628706:AAEnEIApKgwx-KsTOtIGHgV4ZhpAt_E7RMw";
const SUPER_ADMIN = 8045367594;
const FIREBASE_DB = "https://aura-star-pay-default-rtdb.firebaseio.com";

// ইন-মেমোরি স্টোরেজ (Render-এ দ্রুত কাজের জন্য)
const memoryStore = {
  bots: {},             // { [botId]: { token, username, firstName } }
  users: {},            // { [botId]: Set of userIds }
  allDatabaseUsers: new Set(), // ফায়ারবেসের আগের + নতুন সমস্ত ইউজার
  adminState: null
};

// Telegram API Helper
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

// Firebase REST API
async function dbGet(path = "") {
  try {
    const url = path ? `${FIREBASE_DB}/${path}.json` : `${FIREBASE_DB}/.json`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Firebase error ${res.status}: ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("Firebase Get Error:", err);
    return null;
  }
}

async function dbSet(path, data) {
  try {
    await fetch(`${FIREBASE_DB}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {}
}

async function dbDelete(path) {
  try {
    await fetch(`${FIREBASE_DB}/${path}.json`, { method: "DELETE" });
  } catch (err) {}
}

// 🔍 ফায়ারবেসের যেকোনো কোনায় থাকা সমস্ত Telegram ID খুঁজে বের করার স্ক্যানার
function deeplyExtractUserIds(data, collected = new Set(), depth = 0) {
  if (!data || depth > 8) return collected;

  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      // যদি কী নিজেই টেলিগ্রাম আইডি হয় (৭ থেকে ১৫ ডিজিটের সংখ্যা)
      if (/^\d{7,15}$/.test(key)) {
        collected.add(String(key));
      }

      // অবজেক্টের ভেতরের প্রোপার্টি চেক (id, userId, chat_id ইত্যাদি)
      if (value && typeof value === "object") {
        deeplyExtractUserIds(value, collected, depth + 1);
      } else if (typeof value === "number" || typeof value === "string") {
        const strVal = String(value).trim();
        if (/^\d{7,15}$/.test(strVal)) {
          const lKey = key.toLowerCase();
          if (
            lKey === "id" ||
            lKey === "userid" ||
            lKey === "user_id" ||
            lKey === "chatid" ||
            lKey === "chat_id" ||
            lKey === "from_id"
          ) {
            collected.add(strVal);
          }
        }
      }
    }
  }
  return collected;
}

// ডাটাবেজের সমস্ত পুরাতন ইউজার ও বট লোড করার ফাংশন
async function syncAllDataFromFirebase() {
  const mainBotId = MAIN_BOT_TOKEN.split(":")[0];
  if (!memoryStore.users[mainBotId]) memoryStore.users[mainBotId] = new Set();

  try {
    console.log("[Sync] ফায়ারবেস থেকে আগের ইউজার লোড হচ্ছে...");
    const entireDb = await dbGet(""); // পুরো ডাটাবেজ একবারে স্ক্যান

    if (entireDb && typeof entireDb === "object") {
      const allFound = deeplyExtractUserIds(entireDb);
      allFound.forEach((uid) => {
        memoryStore.allDatabaseUsers.add(uid);
        memoryStore.users[mainBotId].add(uid);
      });

      // সংযুক্ত বটগুলো লোড করা
      if (entireDb.bots) {
        for (const [bId, bData] of Object.entries(entireDb.bots)) {
          if (bData.info) memoryStore.bots[bId] = bData.info;
          if (!memoryStore.users[bId]) memoryStore.users[bId] = new Set();
          if (bData.users) {
            const bUsers = deeplyExtractUserIds(bData.users);
            bUsers.forEach((uid) => {
              memoryStore.users[bId].add(uid);
              memoryStore.allDatabaseUsers.add(uid);
            });
          }
        }
      }
      console.log(`[Sync] সফল! মোট পাওয়া ইউজার: ${memoryStore.allDatabaseUsers.size}`);
      return memoryStore.allDatabaseUsers.size;
    } else {
      console.log("[Sync] ডাটাবেজ খালি অথবা পারমিশন নেই।");
      return 0;
    }
  } catch (err) {
    console.error("[Sync Error]:", err);
    return 0;
  }
}

// সার্ভার ওপেন হওয়ার সাথে সাথেই ব্যাকগ্রাউন্ডে পুরো ডাটাবেজ স্ক্যান হবে
syncAllDataFromFirebase();

// সুপার এডমিনের স্থায়ী মেনু বাটন (Reply Keyboard)
const adminReplyKeyboard = {
  keyboard: [
    [{ text: "➕ Add Bot" }, { text: "➖ Remove Bot" }],
    [{ text: "📋 Bot List" }, { text: "🔍 DB চেক ও ইউজার সংখ্যা" }],
    [{ text: "📢 Single Broadcast" }, { text: "🌐 All Bots Broadcast" }],
    [{ text: "❌ Cancel" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

// সাধারণ ইউজারদের জন্য অফ নোটিশ ও লিংক বাটন
const defaultOffText = `⛔ Bot currently off!\n🔧 Source: SΛKIB 〆 DΞVΞLOPΞR\nSupport: @AuraSupportsBot`;
const defaultButtons = {
  inline_keyboard: [
    [{ text: "🔧 Source: SΛKIB 〆 DΞVΞLOPΞR", url: "https://t.me/Sakib_Developer1" }],
    [{ text: "Support: @AuraSupportsBot", url: "https://t.me/AuraSupportsBot" }]
  ]
};

// ব্যাকগ্রাউন্ডে ব্রডকাস্ট পাঠানোর ফাংশন (টাইমআউট মুক্ত)
async function startBroadcast(token, userIds, fromChatId, messageId, adminChatId, broadcastName) {
  const userList = Array.from(userIds);
  await tgRequest(MAIN_BOT_TOKEN, "sendMessage", {
    chat_id: adminChatId,
    text: `⏳ **${broadcastName}** শুরু হয়েছে!\nমোট টার্গেট ইউজার: ${userList.length} জন...`,
    parse_mode: "Markdown"
  });

  let success = 0;
  let fail = 0;

  for (const uId of userList) {
    const res = await tgRequest(token, "copyMessage", {
      chat_id: uId,
      from_chat_id: fromChatId,
      message_id: messageId
    });

    if (res && res.ok) success++;
    else fail++;

    // টেলিগ্রামের রেট লিমিট এড়াতে সাময়িক বিরতি
    await new Promise((r) => setTimeout(r, 40));
  }

  await tgRequest(MAIN_BOT_TOKEN, "sendMessage", {
    chat_id: adminChatId,
    text: `🎉 **${broadcastName} সম্পন্ন!**\n\n✅ সফল: ${success}\n❌ ব্যর্থ (বট ব্লক/চ্যাট নেই): ${fail}`,
    reply_markup: adminReplyKeyboard
  });
}

// হেলথ চেক রুট
app.get("/", (req, res) => {
  res.send("Bot Engine is Running Live!");
});

// মূল রিসিভার হ্যান্ডলার
async function handleUpdate(req, res) {
  const currentToken = req.query?.token || MAIN_BOT_TOKEN;
  const currentBotId = currentToken.split(":")[0];
  const isMainBot = currentToken === MAIN_BOT_TOKEN;

  const update = req.body;
  if (!update) return res.status(200).send("No update");

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `https://${host}/api`;

  // ---------------- ১. ইনলাইন বাটন হ্যান্ডলিং ----------------
  if (update.callback_query) {
    const cb = update.callback_query;
    const adminId = cb.from.id;
    const data = cb.data;

    if (Number(adminId) === SUPER_ADMIN && isMainBot) {
      await tgRequest(currentToken, "answerCallbackQuery", { callback_query_id: cb.id });

      if (data.startsWith("del_bot_")) {
        const removeId = data.replace("del_bot_", "");
        const targetBot = memoryStore.bots[removeId];
        if (targetBot && targetBot.token) {
          await tgRequest(targetBot.token, "deleteWebhook");
        }
        delete memoryStore.bots[removeId];
        delete memoryStore.users[removeId];
        dbDelete(`bots/${removeId}`);

        await tgRequest(currentToken, "sendMessage", {
          chat_id: adminId,
          text: `✅ বট ID: \`${removeId}\` রিমুভ করা হয়েছে!`,
          parse_mode: "Markdown",
          reply_markup: adminReplyKeyboard
        });
      } else if (data.startsWith("target_bc_")) {
        const targetId = data.replace("target_bc_", "");
        memoryStore.adminState = { step: "WAITING_SINGLE_BC", targetBotId: targetId };

        await tgRequest(currentToken, "sendMessage", {
          chat_id: adminId,
          text: `📝 বট ID: \`${targetId}\` এর সমস্ত ইউজারের জন্য যেকোনো মেসেজ/ছবি পাঠান:\n\n(বাতিল করতে '❌ Cancel' বাটন চাপুন)`,
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "❌ Cancel" }]],
            resize_keyboard: true
          }
        });
      }
    }
    return res.status(200).send("OK");
  }

  // ---------------- ২. মেসেজ হ্যান্ডলিং ----------------
  const message = update.message;
  if (!message) return res.status(200).send("No message");

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text ? message.text.trim() : "";

  // নতুন ইউজার মেমোরি ও ফায়ারবেসে সেভ
  if (!memoryStore.users[currentBotId]) memoryStore.users[currentBotId] = new Set();
  memoryStore.users[currentBotId].add(String(userId));
  memoryStore.allDatabaseUsers.add(String(userId));

  dbSet(`bots/${currentBotId}/users/${userId}`, {
    id: userId,
    first_name: message.from.first_name || "",
    username: message.from.username || "",
    last_active: Date.now()
  });

  // ---------------- ৩. সুপার এডমিন কন্ট্রোল (মেইন বটে) ----------------
  if (Number(userId) === SUPER_ADMIN && isMainBot) {
    if (text === "❌ Cancel" || text === "/cancel") {
      memoryStore.adminState = null;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🚫 অপারেশন বাতিল করা হয়েছে।",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    if (text === "/start" || text === "/admin" || text === "🔙 Main Menu") {
      memoryStore.adminState = null;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: `👑 **এডমিন কন্ট্রোল প্যানেল**\n\nনিচের বাটনগুলো ব্যবহার করে সিস্টেম পরিচালনা করুন:`,
        parse_mode: "Markdown",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    // এডমিন ইনপুট হ্যান্ডলিং
    if (memoryStore.adminState) {
      // (ক) বট টোকেন কানেক্ট করা
      if (memoryStore.adminState.step === "WAITING_BOT_TOKEN") {
        const inputToken = text;
        const testBot = await tgRequest(inputToken, "getMe");

        if (!testBot || !testBot.ok) {
          await tgRequest(currentToken, "sendMessage", {
            chat_id: chatId,
            text: "❌ ভুল টোকেন! টেলিগ্রামে বটটি পাওয়া যায়নি। সঠিক Token দিন অথবা '❌ Cancel' চাপুন।",
            reply_markup: {
              keyboard: [[{ text: "❌ Cancel" }]],
              resize_keyboard: true
            }
          });
          return res.status(200).send("OK");
        }

        const newBot = testBot.result;
        const webhookUrl = `${baseUrl}?token=${inputToken}`;
        await tgRequest(inputToken, "setWebhook", { url: webhookUrl });

        const botInfo = {
          id: newBot.id,
          username: newBot.username,
          first_name: newBot.first_name,
          token: inputToken,
          connected_at: Date.now()
        };

        memoryStore.bots[newBot.id] = botInfo;
        dbSet(`bots/${newBot.id}/info`, botInfo);

        memoryStore.adminState = null;

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `🎉 **বট সফলভাবে যুক্ত হয়েছে!**\n\n🤖 নাম: ${newBot.first_name}\n🔗 ইউজারনেম: @${newBot.username}\n🆔 ID: \`${newBot.id}\``,
          parse_mode: "Markdown",
          reply_markup: adminReplyKeyboard
        });
        return res.status(200).send("OK");
      }

      // (খ) সিঙ্গেল বট ব্রডকাস্ট
      if (memoryStore.adminState.step === "WAITING_SINGLE_BC") {
        const targetBotId = memoryStore.adminState.targetBotId;
        let targetToken = currentToken;

        if (targetBotId !== currentBotId && memoryStore.bots[targetBotId]) {
          targetToken = memoryStore.bots[targetBotId].token;
        }

        // টার্গেট বটের আগের ও বর্তমান সকল ইউজার
        let targetUserIds = memoryStore.users[targetBotId] || new Set();
        // যদি মেইন বট সিলেক্ট করা হয়, তবে ফায়ারবেসের আগের সব ইউজারদের টার্গেট করা হবে
        if (targetBotId === currentBotId) {
          targetUserIds = memoryStore.allDatabaseUsers;
        }

        memoryStore.adminState = null;
        res.status(200).send("OK"); // টেলিগ্রামকে সাথে সাথে রেসপন্স দেওয়া

        // ব্যাকগ্রাউন্ডে ব্রডকাস্ট পাঠানো
        startBroadcast(
          targetToken,
          targetUserIds,
          chatId,
          message.message_id,
          chatId,
          `বট ID (${targetBotId}) ব্রডকাস্ট`
        );
        return;
      }

      // (গ) অল বট ব্রডকাস্ট
      if (memoryStore.adminState.step === "WAITING_ALL_BC") {
        const allTargets = memoryStore.allDatabaseUsers;
        memoryStore.adminState = null;
        res.status(200).send("OK");

        // মেইন বট দিয়ে আগের ও বর্তমান সমস্ত ইউজারের কাছে মেসেজ পাঠানো
        startBroadcast(
          MAIN_BOT_TOKEN,
          allTargets,
          chatId,
          message.message_id,
          chatId,
          "অল বট ব্রডকাস্ট"
        );
        return;
      }
    }

    // বাটন অ্যাকশন
    if (text === "➕ Add Bot") {
      memoryStore.adminState = { step: "WAITING_BOT_TOKEN" };
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "📥 আপনি যে বটটি কানেক্ট করতে চান তার **Bot Token** টি পাঠিয়ে দিন:\n\n(বাতিল করতে '❌ Cancel' চাপুন)",
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "❌ Cancel" }]],
          resize_keyboard: true
        }
      });
      return res.status(200).send("OK");
    }

    if (text === "🔍 DB চেক ও ইউজার সংখ্যা") {
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "⏳ ডাটাবেজ পুনরায় স্ক্যান করা হচ্ছে..."
      });
      const count = await syncAllDataFromFirebase();
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: `📊 **ডাটাবেজ রিপোর্ট:**\n\nফায়ারবেস থেকে মোট **${count}** জন আগের ও নতুন ইউজারের আইডি সফলভাবে লোড করা হয়েছে!\n\nএখন ব্রডকাস্ট দিলে এই সমস্ত ইউজারের কাছে মেসেজ চলে যাবে।`,
        parse_mode: "Markdown",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    if (text === "📋 Bot List") {
      const keys = Object.keys(memoryStore.bots);
      let msg = `🤖 **মেইন বট:** Aura Star Pay\n👥 ডাটাবেজের মোট ইউজার: ${memoryStore.allDatabaseUsers.size}\n\n━━━━━━━━━━━━━━━\n📋 **কানেক্টেড বট তালিকা:**\n\n`;

      if (keys.length === 0) {
        msg += "⚠️ বর্তমানে কোনো অতিরিক্ত বট কানেক্ট করা নেই।";
      } else {
        for (const [id, bot] of Object.entries(memoryStore.bots)) {
          const uCount = memoryStore.users[id] ? memoryStore.users[id].size : 0;
          msg += `🔹 @${bot.username || "Unknown"}\n   ID: \`${id}\`\n   👥 নতুন অ্যাক্টিভ ইউজার: ${uCount}\n\n`;
        }
      }

      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: msg,
        parse_mode: "Markdown",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    if (text === "➖ Remove Bot") {
      const keys = Object.keys(memoryStore.bots);
      if (keys.length === 0) {
        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ রিমুভ করার মতো কোনো অতিরিক্ত বট নেই।",
          reply_markup: adminReplyKeyboard
        });
        return res.status(200).send("OK");
      }

      const inlineBtns = [];
      for (const [id, bot] of Object.entries(memoryStore.bots)) {
        inlineBtns.push([{ text: `❌ Delete @${bot.username || id}`, callback_data: `del_bot_${id}` }]);
      }

      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "⚠️ কোন বটটি রিমুভ করতে চান সিলেক্ট করুন:",
        reply_markup: { inline_keyboard: inlineBtns }
      });
      return res.status(200).send("OK");
    }

    if (text === "📢 Single Broadcast") {
      const inlineBtns = [
        [{ text: `📢 Main Bot (আগের সব ${memoryStore.allDatabaseUsers.size} ইউজার)`, callback_data: `target_bc_${currentBotId}` }]
      ];
      for (const [id, bot] of Object.entries(memoryStore.bots)) {
        inlineBtns.push([{ text: `📢 @${bot.username || id}`, callback_data: `target_bc_${id}` }]);
      }

      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🎯 যে বটটিতে ব্রডকাস্ট করতে চান বেছে নিন:",
        reply_markup: { inline_keyboard: inlineBtns }
      });
      return res.status(200).send("OK");
    }

    if (text === "🌐 All Bots Broadcast") {
      memoryStore.adminState = { step: "WAITING_ALL_BC" };
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: `🌐 **অল বট ব্রডকাস্ট:**\n\nডাটাবেজে থাকা আগের ও বর্তমান সমস্ত (${memoryStore.allDatabaseUsers.size} জন) ইউজারের কাছে পাঠানোর জন্য মেসেজটি পাঠান:\n\n(বাতিল করতে '❌ Cancel' বাটন চাপুন)`,
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "❌ Cancel" }]],
          resize_keyboard: true
        }
      });
      return res.status(200).send("OK");
    }

    // এডমিনের জন্য সাধারণ রেসপন্স
    await tgRequest(currentToken, "sendMessage", {
      chat_id: chatId,
      text: "👑 নিচের মেনু বাটন ব্যবহার করুন:",
      reply_markup: adminReplyKeyboard
    });
    return res.status(200).send("OK");
  }

  // ---------------- ৪. সাধারণ ইউজারদের জন্য রেসপন্স ----------------
  await tgRequest(currentToken, "sendMessage", {
    chat_id: chatId,
    text: defaultOffText,
    reply_markup: defaultButtons
  });

  return res.status(200).send("OK");
}

app.post("/api", handleUpdate);
app.post("/", handleUpdate);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
