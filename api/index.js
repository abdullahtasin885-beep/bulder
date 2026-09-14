import express from "express";

const app = express();
app.use(express.json());

// কনফিগারেশন
const MAIN_BOT_TOKEN = "8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo";
const SUPER_ADMIN = 8045367594;
const FIREBASE_DB = "https://bkas-45e17-default-rtdb.firebaseio.com";

// ইন-মেমোরি ক্যাশ (Render-এ ইনস্ট্যান্ট এবং ১০০% নিশ্চিত কাজ করার জন্য)
const memoryStore = {
  bots: {},          // { [botId]: { token, username, firstName } }
  users: {},         // { [botId]: { [userId]: true } }
  adminState: null   // { step: '...', targetBotId: '...' }
};

// টেলিগ্রাম API রিকোয়েস্ট ফাংশন
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

// ফায়ারবেস REST API ফাংশন (ব্যাকগ্রাউন্ডে সেভ হবে)
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

// সার্ভার স্টার্ট হলে পূর্বের বটগুলো মেমোরিতে লোড করা
(async () => {
  const savedBots = await dbGet("bots");
  if (savedBots) {
    for (const [botId, bData] of Object.entries(savedBots)) {
      if (bData.info) {
        memoryStore.bots[botId] = bData.info;
      }
      if (bData.users) {
        memoryStore.users[botId] = bData.users;
      }
    }
    console.log(`[Startup] Loaded ${Object.keys(memoryStore.bots).length} bots from Firebase.`);
  }
})();

// সুপার এডমিনের স্থায়ী রিপ্লাই কিবোর্ড (নিচের মেনু বাটন)
const adminReplyKeyboard = {
  keyboard: [
    [{ text: "➕ Add Bot" }, { text: "➖ Remove Bot" }],
    [{ text: "📋 Bot List & Stats" }],
    [{ text: "📢 Single Broadcast" }, { text: "🌐 All Bots Broadcast" }],
    [{ text: "❌ Cancel" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

// সাধারণ ইউজারদের জন্য নির্ধারিত রেসপন্স বাটন
const defaultOffText = `⛔ Bot currently off!\n🔧 Source: SΛKIB 〆 DΞVΞLOPΞR\nSupport: @AuraSupportsBot`;
const defaultButtons = {
  inline_keyboard: [
    [{ text: "🔧 Source: SΛKIB 〆 DΞVΞLOPΞR", url: "https://t.me/Sakib_Developer1" }],
    [{ text: "Support: @AuraSupportsBot", url: "https://t.me/AuraSupportsBot" }]
  ]
};

// হেলথ চেক রুট (Render একটিভ রাখার জন্য)
app.get("/", (req, res) => {
  res.send("Aura Builder Pro Webhook Server is Live!");
});

// মূল হ্যান্ডলার
async function handleUpdate(req, res) {
  const currentToken = req.query?.token || MAIN_BOT_TOKEN;
  const currentBotId = currentToken.split(":")[0];
  const isMainBot = currentToken === MAIN_BOT_TOKEN;

  const update = req.body;
  if (!update) return res.status(200).send("No update");

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `https://${host}/api`;

  // ---------------- ১. ইনলাইন বাটন হ্যান্ডলিং (এডমিন নির্বাচন) ----------------
  if (update.callback_query) {
    const cb = update.callback_query;
    const adminId = cb.from.id;
    const data = cb.data;

    if (Number(adminId) === SUPER_ADMIN && isMainBot) {
      await tgRequest(currentToken, "answerCallbackQuery", { callback_query_id: cb.id });

      // ডিলিট বট নির্বাচন
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
      }
      // সিঙ্গেল ব্রডকাস্টের জন্য বট বাছাই
      else if (data.startsWith("target_bc_")) {
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

  // ফায়ারবেস এবং মেমোরিতে ইউজার ট্র্যাকিং
  if (!memoryStore.users[currentBotId]) memoryStore.users[currentBotId] = {};
  memoryStore.users[currentBotId][userId] = true;

  dbSet(`bots/${currentBotId}/users/${userId}`, {
    id: userId,
    first_name: message.from.first_name || "",
    username: message.from.username || "",
    last_active: Date.now()
  });

  // ---------------- ৩. সুপার এডমিন কন্ট্রোল (মেইন বটে) ----------------
  if (Number(userId) === SUPER_ADMIN && isMainBot) {

    // ক্যানসেল হ্যান্ডলার
    if (text === "❌ Cancel" || text === "/cancel") {
      memoryStore.adminState = null;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🚫 অপারেশন বাতিল করা হয়েছে। মূল মেনু নিচে দেওয়া হলো:",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    // স্টার্ট বা এডমিন কমান্ড
    if (text === "/start" || text === "/admin" || text === "🔙 Main Menu") {
      memoryStore.adminState = null;
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: `👑 **AURA BUILDER PRO প্যানেলে স্বাগতম!**\n\nনিচের রিপ্লাই বাটনগুলো ব্যবহার করে সম্পূর্ণ সিস্টেম কন্ট্রোল করুন।`,
        parse_mode: "Markdown",
        reply_markup: adminReplyKeyboard
      });
      return res.status(200).send("OK");
    }

    // স্টেট অনুযায়ী কাজ করা (টোকেন নেওয়া / ব্রডকাস্ট নেওয়া)
    if (memoryStore.adminState) {
      // (ক) বট যুক্ত করা
      if (memoryStore.adminState.step === "WAITING_BOT_TOKEN") {
        const inputToken = text;
        const testBot = await tgRequest(inputToken, "getMe");

        if (!testBot || !testBot.ok) {
          await tgRequest(currentToken, "sendMessage", {
            chat_id: chatId,
            text: "❌ ভুল টোকেন! বটটি টেলিগ্রামে পাওয়া যায়নি। অনুগ্রহ করে সঠিক Bot Token দিন অথবা '❌ Cancel' চাপুন।",
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

        // মেমোরি ও ডাটাবেজে সংরক্ষণ
        memoryStore.bots[newBot.id] = botInfo;
        dbSet(`bots/${newBot.id}/info`, botInfo);

        memoryStore.adminState = null;

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `🎉 **বট সফলভাবে কানেক্ট হয়েছে!**\n\n🤖 নাম: ${newBot.first_name}\n🔗 ইউজারনেম: @${newBot.username}\n🆔 ID: \`${newBot.id}\`\n\nএখন এই বটে কোনো ইউজার মেসেজ দিলে স্বয়ংক্রিয়ভাবে অফ নোটিশ দেখাবে এবং ইউজার সেভ হবে।`,
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

        const usersObj = memoryStore.users[targetBotId] || (await dbGet(`bots/${targetBotId}/users`)) || {};
        const userList = Object.keys(usersObj);

        await tgRequest(currentToken, "sendMessage", {
          chat_id: chatId,
          text: `⏳ ব্রডকাস্ট শুরু হয়েছে মোট ${userList.length} জন ইউজারের কাছে...`
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
          text: `✅ ব্রডকাস্ট সম্পন্ন!\nসফল: ${sCount}\nব্যর্থ: ${fCount}`,
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
          text: `⏳ মোট ${botList.length} টি বটের সমস্ত ইউজারের কাছে ব্রডকাস্ট পাঠানো শুরু হয়েছে...`
        });

        let totalS = 0;
        let totalF = 0;

        for (const b of botList) {
          const uObj = memoryStore.users[b.id] || (await dbGet(`bots/${b.id}/users`)) || {};
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

    // বাটন কমান্ড হ্যান্ডলিং
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
      let msg = `🤖 **মেইন বট:** @AuraBuilderProBot\n👥 ইউজার: ${mainBotUsers}\n\n━━━━━━━━━━━━━━━\n📋 **সংযুক্ত অন্যান্য বট:**\n\n`;

      if (keys.length === 0) {
        msg += "⚠️ কোনো অতিরিক্ত বট কানেক্ট করা নেই।";
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
        text: "⚠️ কোন বটটি রিমুভ করতে চান নিচের বাটন চাপুন:",
        reply_markup: { inline_keyboard: inlineBtns }
      });
      return res.status(200).send("OK");
    }

    if (text === "📢 Single Broadcast") {
      const inlineBtns = [
        [{ text: `📢 Main Bot (@AuraBuilderProBot)`, callback_data: `target_bc_${currentBotId}` }]
      ];
      for (const [id, bot] of Object.entries(memoryStore.bots)) {
        inlineBtns.push([{ text: `📢 @${bot.username || id}`, callback_data: `target_bc_${id}` }]);
      }

      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🎯 যে বটটির ইউজারদের কাছে ব্রডকাস্ট পাঠাতে চান সেটি বেছে নিন:",
        reply_markup: { inline_keyboard: inlineBtns }
      });
      return res.status(200).send("OK");
    }

    if (text === "🌐 All Bots Broadcast") {
      memoryStore.adminState = { step: "WAITING_ALL_BC" };
      await tgRequest(currentToken, "sendMessage", {
        chat_id: chatId,
        text: "🌐 **অল বট ব্রডকাস্ট:**\n\nসবগুলো বটের সমস্ত ইউজারদের কাছে পাঠানোর জন্য যেকোনো টেক্সট, ফটো বা মেসেজ পাঠান:\n\n(বাতিল করতে '❌ Cancel' বাটন চাপুন)",
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "❌ Cancel" }]],
          resize_keyboard: true
        }
      });
      return res.status(200).send("OK");
    }

    // সুপার এডমিন কোনো অচেনা টেক্সট দিলে আবার মেনু দেখানো
    await tgRequest(currentToken, "sendMessage", {
      chat_id: chatId,
      text: "👑 নিচের মেনু বাটন থেকে অপশন সিলেক্ট করুন:",
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
