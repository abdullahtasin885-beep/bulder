import express from "express";

const app = express();
app.use(express.json());

// নতুন তথ্য
const MAIN_BOT_TOKEN = "8809628706:AAEnEIApKgwx-KsTOtIGHgV4ZhpAt_E7RMw";
const SUPER_ADMIN = 8045367594;
const FIREBASE_DB = "https://aura-star-pay-default-rtdb.firebaseio.com";

// ইন-মেমোরি স্টোরেজ
const memoryStore = {
  bots: {},          // { [botId]: { token, username, firstName } }
  users: {},         // { [botId]: { [userId]: true } }
  adminState: null   // এডমিনের বর্তমান অবস্থা
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

// Firebase REST API Helper
async function dbGet(path) {
  try {
    const res = await fetch(`${FIREBASE_DB}/${path}.json`);
    return await res.json();
  } catch (err) {
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

// ডাটাবেজের যেকোনো অবজেক্ট/লিস্ট থেকে সম্ভাব্য ইউজার আইডি বের করার হেল্পার
function extractUserIds(dataObj) {
  const ids = new Set();
  if (!dataObj || typeof dataObj !== "object") return ids;

  for (const [key, val] of Object.entries(dataObj)) {
    // কী নিজেই যদি টেলিগ্রাম আইডি হয় (সংখ্যা)
    if (/^\d{6,15}$/.test(key)) {
      ids.add(key);
    }
    // অবজেক্টের ভেতর id / userId / chat_id থাকলে
    if (val && typeof val === "object") {
      if (val.id && /^\d{6,15}$/.test(String(val.id))) ids.add(String(val.id));
      if (val.userId && /^\d{6,15}$/.test(String(val.userId))) ids.add(String(val.userId));
      if (val.chat_id && /^\d{6,15}$/.test(String(val.chat_id))) ids.add(String(val.chat_id));
      if (val.chatId && /^\d{6,15}$/.test(String(val.chatId))) ids.add(String(val.chatId));
    }
  }
  return ids;
}

// ডাটাবেজ থেকে আগের সংরক্ষিত সব বট ও সমস্ত পুরাতন ইউজার মেমোরিতে লোড করা
async function loadPreviousData() {
  const mainBotId = MAIN_BOT_TOKEN.split(":")[0];
  if (!memoryStore.users[mainBotId]) memoryStore.users[mainBotId] = {};

  try {
    // ১. /bots থেকে বট এবং তাদের ইউজার লোড
    const savedBots = await dbGet("bots");
    if (savedBots) {
      for (const [botId, bData] of Object.entries(savedBots)) {
        if (bData.info) memoryStore.bots[botId] = bData.info;
        if (!memoryStore.users[botId]) memoryStore.users[botId] = {};

        if (bData.users) {
          const ids = extractUserIds(bData.users);
          ids.forEach(uid => (memoryStore.users[botId][uid] = true));
        }
      }
    }

    // ২. আপনার ডাটাবেজে আগে থেকে থাকা কমন ফোল্ডারগুলো স্ক্যান করা (/users, /all_users, /members ইত্যাদি)
    const possiblePaths = ["users", "all_users", "members", "bot_users", "subscribers", "data"];
    for (const p of possiblePaths) {
      const pData = await dbGet(p);
      if (pData) {
        const ids = extractUserIds(pData);
        ids.forEach(uid => {
          memoryStore.users[mainBotId][uid] = true;
        });
      }
    }

    const totalLoaded = Object.keys(memoryStore.users[mainBotId]).length;
    console.log(`[Database Sync] Found ${totalLoaded} existing users in Firebase!`);
  } catch (err) {
    console.error("Load Previous Data Error:", err);
  }
}

// সার্ভার স্টার্টে লোড চালানো
loadPreviousData();

// সুপার এডমিনের বড় মেনু বাটন (Reply Keyboard)
const adminReplyKeyboard = {
  keyboard: [
    [{ text: "➕ Add Bot" }, { text: "➖ Remove Bot" }],
    [{ text: "📋 Bot List & Stats" }],
    [{ text: "📢 Single Broadcast" }, { text: "🌐 All Bots Broadcast" }],
    [{ text: "🔄 Refresh Old Users" }, { text: "❌ Cancel" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

// ইউজারদের জন্য নির্ধারিত নোটিশ ও বাটন
const defaultOffText = `⛔ Bot currently off!\n🔧 Source: SΛKIB 〆 DΞVΞLOPΞR\nSupport: @AuraSupportsBot`;
const defaultButtons = {
  inline_keyboard: [
    [{ text: "🔧 Source: SΛKIB 〆 DΞVΞLOPΞR", url: "https://t.me/Sakib_Developer1" }],
    [{ text: "Support: @AuraSupportsBot", url: "https://t.me/AuraSupportsBot" }]
  ]
};

// সার্ভার হেলথ চেক
app.get("/", (req, res) => {
  res.send("Aura Star Pay Multi-Bot Engine is Running Live!");
});

// মূল হ্যান্ডলার ফাংশন
async function handleTelegramUpdate(req, res) {
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
          text: `✅ বট ID: \`${removeId}\` সফলভাবে রিমুভ করা হয়েছে!`,
          parse_mode: "Markdown",
          reply_markup: adminReplyKeyboard
        });
      } else if (data.startsWith("target_bc_")) {
        const targetId = data.replace("target_bc_", "");
        memoryStore.adminState = { step: "WAITING_SINGLE_BC", targetBotId: targetId };

        await tgRequest(currentToken, "sendMessage", {
          chat_id: adminId,
          text: `📝 বট ID: \`${targetId}\` এর ইউজারদের জন্য যেকোনো মেসেজ/ছবি পাঠান:\n\n(বাতিল করতে '❌ Cancel' বাটন চাপুন)`,
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

  // নতুন ইউজার ফায়ারবেস এবং মেমোরিতে সেভ করা
  if (!memoryStore.users[currentBotId]) memoryStore.users[currentBotId] = {};
  memoryStore.users[currentBotId][userId] = true;

  dbSet(`bots/${currentBotId}/users/${userId}`, {
    id: userId,
    first_name: message.from.first_name || "",
    username: message.from.username || "",
    last_active: Date.now()
  });

  // ---------------- ৩. সুপার এডমিন কন্ট্রোল ----------------
  if (Number(userId) === SUPER_ADMIN && isMainBot) {
    if (text === "❌ Cancel" || text === "/cancel") {
      memoryStore.adminState = null;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🚫 অপারেশন বাতিল করা হয়েছে। মূল মেনু নিচে দেওয়া হলো:",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    if (text === "/start" || text === "/admin" || text === "🔙 Main Menu") {
      memoryStore.adminState = null;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: `👑 **AURA STAR PAY কন্ট্রোল প্যানেল**\n\nনিচের বাটনগুলো ব্যবহার করে সিস্টেম পরিচালনা করুন:`,
        parse_mode: "Markdown",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    // স্টেট অনুযায়ী কাজ করা (টোকেন বা ব্রডকাস্ট মেসেজ রিসিভ)
    if (memoryStore.adminState) {
      // (ক) নতুন বট কানেক্ট করা
      if (memoryStore.adminState.step === "WAITING_BOT_TOKEN") {
        const inputToken = text;
        const testBot = await tgRequest(inputToken, "getMe");

        if (!testBot || !testBot.ok) {
          await tgRequest(currentToken, "sendMessage", {
            chat_id: chatId,
            text: "❌ ভুল টোকেন! বটটি খুঁজে পাওয়া যায়নি। অনুগ্রহ করে সঠিক Token দিন অথবা '❌ Cancel' চাপুন।",
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

        // যদি পূর্বে এই বটের কোনো ইউজার ফায়ারবেসে থেকে থাকে তা সিঙ্ক করা
        const oldBotData = await dbGet(`bots/${newBot.id}/users`);
        if (oldBotData) {
          if (!memoryStore.users[newBot.id]) memoryStore.users[newBot.id] = {};
          const ids = extractUserIds(oldBotData);
          ids.forEach(uid => (memoryStore.users[newBot.id][uid] = true));
        }

        memoryStore.adminState = null;

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `🎉 **বট সফলভাবে কানেক্ট হয়েছে!**\n\n🤖 নাম: ${newBot.first_name}\n🔗 ইউজারনেম: @${newBot.username}\n🆔 ID: \`${newBot.id}\`\n\nএখন থেকে এই বটে মেসেজ দিলে অটোমেটিক অফ নোটিশ দেখাবে।`,
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

        const usersObj = memoryStore.users[targetBotId] || {};
        const userList = Object.keys(usersObj);

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `⏳ ব্রডকাস্ট পাঠানো শুরু হয়েছে মোট ${userList.length} জন ইউজারের কাছে...`
        });

        let sCount = 0;
        let fCount = 0;
        for (const uId of userList) {
          const r = await tgRequest(targetToken, "copyMessage", {
            chat_id: uId,
            from_chat_id: chatId,
            message_id: message.message_id
          });
          if (r && r.ok) sCount++;
          else fCount++;
        }

        memoryStore.adminState = null;
        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `✅ সিঙ্গেল বট ব্রডকাস্ট সম্পন্ন!\nসফল: ${sCount}\nব্যর্থ: ${fCount}`,
          reply_markup: adminReplyKeyboard
        });
        return res.status(200).send("OK");
      }

      // (গ) অল বট ব্রডকাস্ট
      if (memoryStore.adminState.step === "WAITING_ALL_BC") {
        const botList = [{ id: currentBotId, token: MAIN_BOT_TOKEN }];
        for (const [bId, bData] of Object.entries(memoryStore.bots)) {
          if (bId !== currentBotId && bData.token) {
            botList.push({ id: bId, token: bData.token });
          }
        }

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `⏳ মোট ${botList.length} টি বটের সমস্ত ইউজারের কাছে ব্রডকাস্ট শুরু হচ্ছে...`
        });

        let totalS = 0;
        let totalF = 0;

        for (const b of botList) {
          const uObj = memoryStore.users[b.id] || {};
          for (const uId of Object.keys(uObj)) {
            const r = await tgRequest(b.token, "copyMessage", {
              chat_id: uId,
              from_chat_id: chatId,
              message_id: message.message_id
            });
            if (r && r.ok) totalS++;
            else totalF++;
          }
        }

        memoryStore.adminState = null;
        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `🎉 **অল বট ব্রডকাস্ট সম্পন্ন!**\n\nমোট ডেলিভারি: ${totalS}\nব্যর্থ: ${totalF}`,
          parse_mode: "Markdown",
          reply_markup: adminReplyKeyboard
        });
        return res.status(200).send("OK");
      }
    }

    // বাটন হ্যান্ডলারস
    if (text === "➕ Add Bot") {
      memoryStore.adminState = { step: "WAITING_BOT_TOKEN" };
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "📥 আপনি যে বটটি কানেক্ট করতে চান তার **Bot Token** টি পাঠিয়ে দিন:",
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "❌ Cancel" }]],
          resize_keyboard: true
        }
      });
      return res.status(200).send("OK");
    }

    if (text === "📋 Bot List & Stats") {
      const keys = Object.keys(memoryStore.bots);
      const mainBotUsers = memoryStore.users[currentBotId] ? Object.keys(memoryStore.users[currentBotId]).length : 0;
      let msg = `🤖 **মেইন বট:** Aura Star Pay\n👥 মোট আগের ও বর্তমান ইউজার: ${mainBotUsers}\n\n━━━━━━━━━━━━━━━\n📋 **কানেক্টেড অতিরিক্ত বট:**\n\n`;

      if (keys.length === 0) {
        msg += "⚠️ বর্তমানে কোনো অতিরিক্ত বট কানেক্ট করা নেই।";
      } else {
        for (const [id, bot] of Object.entries(memoryStore.bots)) {
          const uCount = memoryStore.users[id] ? Object.keys(memoryStore.users[id]).length : 0;
          msg += `🔹 @${bot.username || "Unknown"}\n   ID: \`${id}\`\n   👥 ইউজার: ${uCount}\n\n`;
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
          text: "⚠️ রিমুভ করার মতো কোনো সংযুক্ত বট নেই।",
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
        [{ text: `📢 Main Bot (Aura Star Pay)`, callback_data: `target_bc_${currentBotId}` }]
      ];
      for (const [id, bot] of Object.entries(memoryStore.bots)) {
        inlineBtns.push([{ text: `📢 @${bot.username || id}`, callback_data: `target_bc_${id}` }]);
      }

      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🎯 যে বটটিতে ব্রডকাস্ট করতে চান সেটি সিলেক্ট করুন:",
        reply_markup: { inline_keyboard: inlineBtns }
      });
      return res.status(200).send("OK");
    }

    if (text === "🌐 All Bots Broadcast") {
      memoryStore.adminState = { step: "WAITING_ALL_BC" };
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🌐 **অল বট ব্রডকাস্ট:**\n\nসবগুলো বটের পুরোনো ও নতুন সমস্ত ইউজারের কাছে পাঠানোর জন্য মেসেজ বা ছবি পাঠান:\n\n(বাতিল করতে '❌ Cancel' বাটন চাপুন)",
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "❌ Cancel" }]],
          resize_keyboard: true
        }
      });
      return res.status(200).send("OK");
    }

    if (text === "🔄 Refresh Old Users") {
      await loadPreviousData();
      const count = memoryStore.users[currentBotId] ? Object.keys(memoryStore.users[currentBotId]).length : 0;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: `✅ ডাটাবেজ পুনরায় স্ক্যান করা হয়েছে!\nমোট ইউজার পাওয়া গেছে: ${count}`,
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    // অন্য যেকোনো টেক্সটে এডমিন মেনু
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

app.post("/api", handleTelegramUpdate);
app.post("/", handleTelegramUpdate);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
