/*
|--------------------------------------------------------------------------
| TELEGRAM MULTI-BOT BUILDER ENGINE (100% PRODUCTION READY)
| - Builder Token: 8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo
| - Builder Username: @AuraBuilderProBot
| - Builder Super Admin: 8045367594
| - Isolated Realtime Firebase Storage: /bots/{botId}/...
|--------------------------------------------------------------------------
*/

const express = require('express');

// ==========================================
// 1. SYSTEM CONFIGURATION
// ==========================================
const BUILDER_BOT_TOKEN = process.env.BUILDER_BOT_TOKEN || '8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo';
const BUILDER_BOT_USERNAME = 'AuraBuilderProBot';
const BUILDER_SUPER_ADMIN_ID = '8045367594';
const APP_URL = process.env.APP_URL || 'https://star-pay-go71.onrender.com'; // আপনার লাইভ সার্ভার/রেন্ডার ডোমেইন
const FIREBASE_DB_URL = 'https://bkas-45e17-default-rtdb.firebaseio.com';

// Local In-Memory RAM Engines
const builderMemory = {
    states: new Map(),
    bots: new Map(),
    settings: {
        bkash: '01XXXXXXXXX',
        nagad: '01XXXXXXXXX',
        upgrade_fee: '150 BDT',
        support_url: 'https://t.me/AuraSupportsBot'
    }
};

const childCaches = new Map();

/*
|--------------------------------------------------------------------------
| 2. HELPERS & REST CLIENTS
|--------------------------------------------------------------------------
*/
function escapeHtml(text) {
    if (typeof text !== 'string') text = String(text ?? '');
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNumber(num) {
    num = Number(num);
    if (isNaN(num) || !isFinite(num)) return '0';
    return Math.abs(num - Math.round(num)) < 0.005 ? Math.round(num).toString() : (Math.round(num * 100) / 100).toString();
}

function formatTimestamp(sec) {
    if (!sec) return 'N/A';
    return new Date(Number(sec) * 1000).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
}

async function firebaseRequest(path, method = 'GET', data = null) {
    path = path.replace(/^\/+|\/+$/g, '');
    const url = `${FIREBASE_DB_URL}/${path}.json`;
    const options = {
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' }
    };
    if (data !== null) options.body = JSON.stringify(data);

    try {
        const res = await fetch(url, options);
        if (!res.ok) return null;
        const text = await res.text();
        return (text === 'null' || !text) ? null : JSON.parse(text);
    } catch (e) {
        console.error(`Firebase Error [${path}]:`, e.message);
        return null;
    }
}

async function telegramApi(token, method, params = {}) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        return await res.json();
    } catch (e) {
        return { ok: false, description: e.message };
    }
}

/*
|--------------------------------------------------------------------------
| 3. MAIN BUILDER BOT CONTROLLER
|--------------------------------------------------------------------------
*/
function getBuilderMenu(userId) {
    const isOwner = String(userId) === BUILDER_SUPER_ADMIN_ID;
    const keyboard = [
        [{ text: 'Create Bot' }, { text: 'Bot List' }],
        [{ text: 'Upgrade Branding' }, { text: 'Support' }]
    ];
    if (isOwner) {
        keyboard.push([{ text: '👑 Admin Control' }]);
    }
    return { keyboard, resize_keyboard: true };
}

async function handleBuilderUpdate(update) {
    // -------------------------------------------------------------
    // Inline Callbacks
    // -------------------------------------------------------------
    if (update.callback_query) {
        const cq = update.callback_query;
        const fromId = String(cq.from.id);
        const data = cq.data || '';

        if (data.startsWith('builder_upgrade_')) {
            const botId = data.replace('builder_upgrade_', '');
            builderMemory.states.set(fromId, { step: 'awaiting_payment_trx', botId });
            await telegramApi(BUILDER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id });

            const payText = 
                `💎 <b>Upgrade Custom Branding</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `বটের সিস্টেম স্ট্যাটাসে আপনার নিজস্ব নাম ও লিংক বসাতে আপগ্রেড করুন।\n\n` +
                `💵 <b>চার্জ:</b> ${builderMemory.settings.upgrade_fee}\n` +
                `📱 <b>বিকাশ (Personal):</b> <code>${builderMemory.settings.bkash}</code>\n` +
                `📱 <b>নগদ (Personal):</b> <code>${builderMemory.settings.nagad}</code>\n\n` +
                `টাকা পাঠিয়ে আপনার <b>TrxID</b> এবং যে নাম্বার থেকে পাঠিয়েছেন তা লিখে পাঠান:`;
            
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: payText,
                parse_mode: 'HTML',
                reply_markup: { keyboard: [[{ text: '❌ Cancel' }]], resize_keyboard: true }
            });
            return;
        }

        if (data.startsWith('adm_approve_upg_') && fromId === BUILDER_SUPER_ADMIN_ID) {
            const botId = data.replace('adm_approve_upg_', '');
            await firebaseRequest(`builder/bots/${botId}`, 'PATCH', { is_upgraded: true });
            
            const b = builderMemory.bots.get(botId);
            if (b) b.is_upgraded = true;

            await telegramApi(BUILDER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Approved!' });
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: cq.message.chat.id,
                text: `✅ <b>Bot (${botId}) Branding Approved!</b>`,
                parse_mode: 'HTML'
            });

            const botData = await firebaseRequest(`builder/bots/${botId}`);
            if (botData?.creator_id) {
                await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                    chat_id: botData.creator_id,
                    text: `🎉 <b>অভিনন্দন!</b> আপনার বট <b>@${botData.bot_username}</b> এর কাস্টম ব্র্যান্ডিং অনুমোদন করা হয়েছে!\nএখন আপনি নিজের বটের এডমিন প্যানেল থেকে সোর্স নেম এবং লিংক পরিবর্তন করতে পারবেন।`,
                    parse_mode: 'HTML'
                });
            }
            return;
        }

        if (data === 'bld_set_bkash' && fromId === BUILDER_SUPER_ADMIN_ID) {
            builderMemory.states.set(fromId, { step: 'adm_set_bkash' });
            await telegramApi(BUILDER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id });
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: 'নতুন বিকাশ নাম্বার পাঠান:' });
            return;
        }

        if (data === 'bld_set_nagad' && fromId === BUILDER_SUPER_ADMIN_ID) {
            builderMemory.states.set(fromId, { step: 'adm_set_nagad' });
            await telegramApi(BUILDER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id });
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: 'নতুন নগদ নাম্বার পাঠান:' });
            return;
        }
    }

    // -------------------------------------------------------------
    // Messages
    // -------------------------------------------------------------
    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const text = (msg.text || '').trim();

    if (text === '❌ Cancel' || text === '/cancel') {
        builderMemory.states.delete(fromId);
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: '❌ Cancelled.',
            reply_markup: getBuilderMenu(fromId)
        });
        return;
    }

    const curState = builderMemory.states.get(fromId);

    // Builder Admin Control
    if (text === '👑 Admin Control' && fromId === BUILDER_SUPER_ADMIN_ID) {
        const allBots = await firebaseRequest('builder/bots') || {};
        const count = Object.keys(allBots).length;
        let listStr = `👑 <b>BUILDER SUPER ADMIN PANEL</b>\n━━━━━━━━━━━━━━━━━━━━\nমোট বট: <b>${count}</b> টি\n\n`;
        for (const [bid, b] of Object.entries(allBots)) {
            listStr += `🤖 @${escapeHtml(b.bot_username)} | ওনার: <code>${b.creator_id}</code> | আপগ্রেড: ${b.is_upgraded ? '✅' : '❌'}\n`;
        }
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: listStr,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📱 Set bKash Number', callback_data: 'bld_set_bkash' }],
                    [{ text: '📱 Set Nagad Number', callback_data: 'bld_set_nagad' }]
                ]
            }
        });
        return;
    }

    // Builder Admin Setting Updates
    if (curState?.step === 'adm_set_bkash' && fromId === BUILDER_SUPER_ADMIN_ID) {
        builderMemory.settings.bkash = text;
        await firebaseRequest('builder/settings/bkash', 'PUT', text);
        builderMemory.states.delete(fromId);
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: `✅ বিকাশ নাম্বার আপডেট হয়েছে: ${text}`, reply_markup: getBuilderMenu(fromId) });
        return;
    }

    if (curState?.step === 'adm_set_nagad' && fromId === BUILDER_SUPER_ADMIN_ID) {
        builderMemory.settings.nagad = text;
        await firebaseRequest('builder/settings/nagad', 'PUT', text);
        builderMemory.states.delete(fromId);
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: `✅ নগদ নাম্বার আপডেট হয়েছে: ${text}`, reply_markup: getBuilderMenu(fromId) });
        return;
    }

    // Menu: Support
    if (text === 'Support') {
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `🎧 <b>Support Team:</b>\n${builderMemory.settings.support_url}`,
            parse_mode: 'HTML'
        });
        return;
    }

    // Menu: Upgrade Branding
    if (text === 'Upgrade Branding') {
        const allBots = await firebaseRequest('builder/bots') || {};
        const userBots = Object.values(allBots).filter(b => String(b.creator_id) === String(fromId));
        if (!userBots.length) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: '⚠️ আপনার তৈরি কোনো বট পাওয়া যায়নি। প্রথমে বট তৈরি করুন!',
                reply_markup: getBuilderMenu(fromId)
            });
            return;
        }

        const buttons = userBots.map(b => [{
            text: `Upgrade @${b.bot_username} ${b.is_upgraded ? '(Active ✅)' : ''}`,
            callback_data: `builder_upgrade_${b.bot_id}`
        }]);

        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: '💎 <b>কোন বটের কাস্টম ব্র্যান্ডিং আপগ্রেড করতে চান? নির্বাচন করুন:</b>',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // Handle Payment Trx submission
    if (curState?.step === 'awaiting_payment_trx') {
        builderMemory.states.delete(fromId);
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: '✅ আপনার পেমেন্ট রিকোয়েস্ট জমা হয়েছে! এডমিন যাচাই করে একটিভ করে দিবে।',
            reply_markup: getBuilderMenu(fromId)
        });

        const targetBot = await firebaseRequest(`builder/bots/${curState.botId}`);
        const alertAdmin = 
            `🔔 <b>নতুন ব্র্যান্ডিং আপগ্রেড পেমেন্ট!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 ইউজার: <code>${fromId}</code>\n` +
            `🤖 বট: @${escapeHtml(targetBot?.bot_username || curState.botId)}\n` +
            `📝 তথ্য: <code>${escapeHtml(text)}</code>`;
        
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: BUILDER_SUPER_ADMIN_ID,
            text: alertAdmin,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '✅ Approve Upgrade', callback_data: `adm_approve_upg_${curState.botId}` }]]
            }
        });
        return;
    }

    // Menu: Bot List
    if (text === 'Bot List') {
        const allBots = await firebaseRequest('builder/bots') || {};
        const userBots = Object.values(allBots).filter(b => String(b.creator_id) === String(fromId));
        if (!userBots.length) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: '📭 আপনি এখনো কোনো বট বানাননি। নিচের <b>Create Bot</b> বাটনে চাপ দিন।',
                parse_mode: 'HTML',
                reply_markup: getBuilderMenu(fromId)
            });
            return;
        }

        let out = `📋 <b>আপনার বট তালিকা:</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const b of userBots) {
            out += `🤖 <b>বট:</b> @${escapeHtml(b.bot_username)}\n` +
                   `🆔 <b>ID:</b> <code>${b.bot_id}</code>\n` +
                   `👑 <b>Admin:</b> <code>${b.super_admin_id}</code>\n` +
                   `💎 <b>Branding:</b> ${b.is_upgraded ? 'কাস্টম ব্র্যান্ডিং অন ✅' : 'বিল্ডার ব্র্যান্ডিং 🔒'}\n\n`;
        }

        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: out,
            parse_mode: 'HTML',
            reply_markup: getBuilderMenu(fromId)
        });
        return;
    }

    // Wizard Step 0: Create Bot
    if (text === 'Create Bot') {
        builderMemory.states.set(fromId, { step: 'awaiting_token' });
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `🤖 <b>আপনার বট টোকেন দিন:</b>\n\n(@BotFather থেকে পাওয়া API Token পাঠান)`,
            parse_mode: 'HTML',
            reply_markup: { keyboard: [[{ text: '❌ Cancel' }]], resize_keyboard: true }
        });
        return;
    }

    // Wizard Step 1: Token Receive
    if (curState?.step === 'awaiting_token') {
        const token = text.trim();
        if (!/^\d{8,11}:[A-Za-z0-9_-]{35}$/.test(token)) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: '❌ ভুল টোকেন! সঠিক Bot Token পাঠান:'
            });
            return;
        }

        const me = await telegramApi(token, 'getMe');
        if (!me.ok) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: `❌ টোকেন কাজ করছে না! Telegram: <i>${escapeHtml(me.description)}</i>\nসঠিক টোকেন পাঠান:`
            });
            return;
        }

        builderMemory.states.set(fromId, {
            step: 'awaiting_username',
            token: token,
            realUsername: me.result.username,
            botId: String(me.result.id)
        });

        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `✅ টোকেন রিসিভ করা হয়েছে!\nবটের নাম: <b>@${me.result.username}</b>\n\nএখন বট ইউজারনেম দিন (যেমন: <code>@${me.result.username}</code>):`,
            parse_mode: 'HTML'
        });
        return;
    }

    // Wizard Step 2: Username Receive
    if (curState?.step === 'awaiting_username') {
        const uName = text.replace('@', '').trim();
        builderMemory.states.set(fromId, {
            ...curState,
            step: 'awaiting_admin_id',
            botUsername: uName
        });

        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `✅ ইউজারনেম রিসিভ করা হয়েছে।\n\nএখন সুপার এডমিন আইডি দিন (আপনার Numeric ID):`,
            parse_mode: 'HTML'
        });
        return;
    }

    // Wizard Step 3: Super Admin ID Receive & Build
    if (curState?.step === 'awaiting_admin_id') {
        if (!/^\d+$/.test(text)) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: '❌ সুপার এডমিন আইডি সংখ্যা (Numeric) হতে হবে। আবার দিন:'
            });
            return;
        }

        const superAdminId = text;
        const botId = curState.botId;
        const childWebhookUrl = `${APP_URL}/webhook/child/${botId}`;

        // Setup Child Bot Webhook
        const whRes = await telegramApi(curState.token, 'setWebhook', {
            url: childWebhookUrl,
            drop_pending_updates: true
        });

        if (!whRes.ok) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: `❌ বট তৈরিতে সমস্যা: <code>${escapeHtml(whRes.description)}</code>`,
                reply_markup: getBuilderMenu(fromId)
            });
            builderMemory.states.delete(fromId);
            return;
        }

        const newBotRecord = {
            bot_id: botId,
            token: curState.token,
            bot_username: curState.botUsername,
            super_admin_id: superAdminId,
            creator_id: fromId,
            is_upgraded: false,
            created_at: Math.floor(Date.now() / 1000)
        };

        await firebaseRequest(`builder/bots/${botId}`, 'PUT', newBotRecord);
        builderMemory.bots.set(botId, newBotRecord);
        builderMemory.states.delete(fromId);

        // Default isolated settings for this newly built child bot
        await firebaseRequest(`bots/${botId}/settings`, 'PUT', {
            coin_name: 'STAR',
            min_withdraw: 2,
            referral_bonus: 1,
            welcome_bonus: 0,
            withdraw_fee_percent: 0,
            bot_power_status: 'on'
        });

        const successMsg = 
            `🎉 <b>আপনার বট সফলভাবে তৈরি হয়েছে!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `🤖 <b>বট:</b> @${escapeHtml(curState.botUsername)}\n` +
            `👑 <b>সুপার এডমিন:</b> <code>${superAdminId}</code>\n` +
            `🔗 <b>লিংক:</b> https://t.me/${curState.botUsername}\n\n` +
            `<i>আপনার বটে গিয়ে /start দিন এবং সম্পুর্ণ বট পরিচালনা করুন!</i>`;

        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: successMsg,
            parse_mode: 'HTML',
            reply_markup: getBuilderMenu(fromId)
        });
        return;
    }

    // Default /start
    await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
        chat_id: fromId,
        text: `🌟 <b>Welcome to ${escapeHtml(BUILDER_BOT_USERNAME)}!</b>\n\nনিচের বাটনগুলো ব্যবহার করে খুব সহজেই আপনার নিজস্ব আর্নিং/উইথড্র বট বানিয়ে নিন:`,
        parse_mode: 'HTML',
        reply_markup: getBuilderMenu(fromId)
    });
}

/*
|--------------------------------------------------------------------------
| 4. CHILD BOT RUNTIME ENGINE (100% ISOLATED MULTI-TENANT)
|--------------------------------------------------------------------------
*/
function getChildCache(botId) {
    if (!childCaches.has(botId)) {
        childCaches.set(botId, {
            users: new Map(),
            settings: new Map(),
            userChannels: new Map(),
            forceChannels: {},
            admins: {},
            blacklist: {},
            whitelist: {},
            botActive: true,
            whitelistOnly: false,
            adminStates: new Map(),
            userStates: new Map()
        });
    }
    return childCaches.get(botId);
}

async function childDb(botId, path, method = 'GET', data = null) {
    return await firebaseRequest(`bots/${botId}/${path}`, method, data);
}

async function handleChildUpdate(botRecord, update) {
    const botToken = botRecord.token;
    const botId = botRecord.bot_id;
    const botUsername = botRecord.bot_username;
    const superAdminId = String(botRecord.super_admin_id);
    const cache = getChildCache(botId);

    // Helpers
    const sendMsg = (cid, txt, rm = null) => telegramApi(botToken, 'sendMessage', {
        chat_id: cid, text: txt, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: rm
    });

    const editMsg = (cid, mid, txt, rm = null) => telegramApi(botToken, 'editMessageText', {
        chat_id: cid, message_id: mid, text: txt, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: rm
    });

    const ansCallback = (cqId, txt = '', show = false) => telegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cqId, text: txt, show_alert: show
    });

    const isChildAdmin = (uid) => String(uid) === superAdminId || Boolean(cache.admins[String(uid)]?.active);

    const getSetting = (k, def = '') => cache.settings.has(k) ? cache.settings.get(k) : def;
    const setSetting = (k, v) => {
        cache.settings.set(k, v);
        childDb(botId, `settings/${k}`, 'PUT', v);
    };

    const getUser = async (uid) => {
        const uKey = String(uid);
        if (cache.users.has(uKey)) return cache.users.get(uKey);
        const res = await childDb(botId, `users/${uKey}`);
        if (res) cache.users.set(uKey, res);
        return res;
    };

    const updateUser = (uid, data) => {
        const uKey = String(uid);
        const cur = cache.users.get(uKey) || {};
        const up = { ...cur, ...data };
        cache.users.set(uKey, up);
        childDb(botId, `users/${uKey}`, 'PATCH', data);
    };

    // Strict Force Join Checker
    const isJoined = async (chId, uid) => {
        const res = await telegramApi(botToken, 'getChatMember', { chat_id: chId, user_id: uid });
        return res?.ok && ['creator', 'administrator', 'member', 'restricted'].includes(res.result?.status);
    };

    const isAllJoined = async (uid) => {
        const channels = Object.values(cache.forceChannels).filter(c => c && c.channel_id);
        if (!channels.length) return true;
        const res = await Promise.all(channels.map(c => isJoined(c.channel_id, uid)));
        return res.every(Boolean);
    };

    // UI Keyboards
    const getUserMenu = (uid) => {
        const kb = [
            [{ text: '👤 My Account' }, { text: '📮 Referral' }],
            [{ text: '💸 Withdraw' }, { text: '📜 History' }],
            [{ text: '📊 System Status' }]
        ];
        if (isChildAdmin(uid)) kb.push([{ text: '🛠 Admin Panel' }]);
        return { keyboard: kb, resize_keyboard: true };
    };

    const getAdminMenu = () => {
        return {
            keyboard: [
                [{ text: cache.botActive ? '🟢 Bot: Active (ON)' : '🔴 Bot: OFF' }, { text: '⚙️ Central Settings' }],
                [{ text: '👥 User & Balance' }, { text: '📢 Users Broadcast' }],
                [{ text: '📢 Force Channels' }, { text: '⭐ সেট Payouts Done' }],
                [{ text: '🔧 Source Settings' }, { text: '🔙 Back to User Panel' }]
            ],
            resize_keyboard: true
        };
    };

    // -------------------------------------------------------------
    // Child Callbacks
    // -------------------------------------------------------------
    if (update.callback_query) {
        const cq = update.callback_query;
        const fromId = String(cq.from.id);
        const data = cq.data || '';
        const cid = cq.message?.chat?.id;
        const mid = cq.message?.message_id;

        if (data === 'verify_join') {
            await ansCallback(cq.id);
            const ok = await isAllJoined(fromId);
            if (!ok) {
                await ansCallback(cq.id, '⚠️ আপনি সব চ্যানেলে জয়েন করেননি!', true);
                return;
            }
            let u = await getUser(fromId);
            updateUser(fromId, { is_verified: true, verification_status: 'verified' });

            if (u?.referred_by && !u.referral_rewarded) {
                const refUser = await getUser(u.referred_by);
                if (refUser) {
                    const rBonus = Number(getSetting('referral_bonus', 1));
                    updateUser(u.referred_by, {
                        balance: Number(refUser.balance || 0) + rBonus,
                        total_referrals: Number(refUser.total_referrals || 0) + 1
                    });
                    updateUser(fromId, { referral_rewarded: true });
                    sendMsg(u.referred_by, `🎉 <b>New Referral Verified!</b>\nBonus: <b>+${rBonus} ${getSetting('coin_name', 'STAR')}</b>`);
                }
            }

            if (mid) await telegramApi(botToken, 'deleteMessage', { chat_id: cid, message_id: mid });
            await sendMsg(fromId, '✅ Verification Successful!', getUserMenu(fromId));
            return;
        }

        // Withdraw Approvals
        if (data.startsWith('c_w_app_') || data.startsWith('c_w_rej_')) {
            await ansCallback(cq.id);
            if (!isChildAdmin(fromId)) return;

            const isApprove = data.startsWith('c_w_app_');
            const wId = data.replace(isApprove ? 'c_w_app_' : 'c_w_rej_', '');
            const wReq = await childDb(botId, `withdrawals/${wId}`);

            if (!wReq || wReq.status !== 'pending') {
                await ansCallback(cq.id, '⚠️ Already processed!', true);
                return;
            }

            const now = Math.floor(Date.now() / 1000);
            if (isApprove) {
                await childDb(botId, `withdrawals/${wId}`, 'PATCH', { status: 'approved', processed_at: now });
                updateUser(wReq.user_id, { has_withdrawn: true });
                sendMsg(wReq.user_id, `🎉 <b>Withdrawal Approved!</b>\n💰 Amount: <b>${wReq.after_fee} ${getSetting('coin_name', 'STAR')}</b>`);
                if (mid) editMsg(cid, mid, `✅ <b>Approved!</b>\nUser: <code>${wReq.user_id}</code> | Amount: <b>${wReq.amount}</b>`);
            } else {
                const targetU = await getUser(wReq.user_id);
                updateUser(wReq.user_id, { balance: Number(targetU?.balance || 0) + Number(wReq.amount || 0) });
                await childDb(botId, `withdrawals/${wId}`, 'PATCH', { status: 'rejected', processed_at: now });
                sendMsg(wReq.user_id, `❌ <b>Withdrawal Rejected!</b>\n${wReq.amount} refunded.`);
                if (mid) editMsg(cid, mid, `❌ <b>Rejected!</b>\nUser: <code>${wReq.user_id}</code>`);
            }
            return;
        }

        // Settings Callbacks
        if (isChildAdmin(fromId)) {
            if (data === 'cfg_coin') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'cfg_coin' });
                await sendMsg(fromId, '🪙 নতুন কয়েন বা কারেন্সি নাম পাঠান (যেমন: ৳, STAR, USDT):');
                return;
            }
            if (data === 'cfg_withdraw') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'cfg_withdraw' });
                await sendMsg(fromId, '💰 নতুন ফিক্সড উইথড্র পরিমাণ লিখুন:');
                return;
            }
            if (data === 'cfg_referral') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'cfg_referral' });
                await sendMsg(fromId, '👥 রেফার বোনাসের পরিমাণ পাঠান:');
                return;
            }
        }
    }

    // -------------------------------------------------------------
    // Child Messages
    // -------------------------------------------------------------
    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();
    const isAdm = isChildAdmin(fromId);

    let u = await getUser(fromId);
    if (!u) {
        let refBy = null;
        const match = text.match(/^\/start\s+(\d+)$/i);
        if (match && match[1] !== fromId) refBy = match[1];

        u = {
            telegram_id: fromId,
            first_name: msg.from.first_name || 'User',
            username: msg.from.username || '',
            balance: 0,
            total_referrals: 0,
            referred_by: refBy,
            referral_rewarded: false,
            is_verified: isAdm,
            created_at: Math.floor(Date.now() / 1000)
        };
        updateUser(fromId, u);
    }

    // Force Join Lock (User must join all channels)
    if (!isAdm) {
        const joined = await isAllJoined(fromId);
        if (!joined) {
            const channels = Object.values(cache.forceChannels).filter(c => c && c.channel_link);
            const kb = channels.map(c => [{ text: c.channel_name || 'Join Channel', url: c.channel_link }]);
            kb.push([{ text: 'Claim / Verify ✅', callback_data: 'verify_join' }]);
            await sendMsg(chatId, `👋 <b>Hello ${escapeHtml(msg.from.first_name)}!</b>\n\nবট ব্যবহার করতে নিচের চ্যানেলে জয়েন করুন:`, { inline_keyboard: kb });
            return;
        }
    }

    // Admin State Handling
    if (isAdm && cache.adminStates.has(fromId)) {
        const aState = cache.adminStates.get(fromId);
        cache.adminStates.delete(fromId);

        if (aState.action === 'cfg_coin') {
            setSetting('coin_name', text.toUpperCase());
            await sendMsg(chatId, `✅ Coin নাম পরিবর্তিত হয়েছে: <b>${escapeHtml(text.toUpperCase())}</b>`, getAdminMenu());
            return;
        }
        if (aState.action === 'cfg_withdraw') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                setSetting('min_withdraw', val);
                await sendMsg(chatId, `✅ ফিক্সড উইথড্র সেট হয়েছে: <b>${val}</b>`, getAdminMenu());
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা পাঠান!', getAdminMenu());
            }
            return;
        }
        if (aState.action === 'cfg_referral') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0) {
                setSetting('referral_bonus', val);
                await sendMsg(chatId, `✅ রেফার বোনাস সেট হয়েছে: <b>${val}</b>`, getAdminMenu());
            }
            return;
        }
        if (aState.action === 'set_payouts_done') {
            setSetting('custom_payouts_done', text);
            await sendMsg(chatId, `✅ Payouts Done সেট হয়েছে: <b>${escapeHtml(text)}</b>`, getAdminMenu());
            return;
        }
        if (aState.action === 'set_source_info') {
            // BRANDING LOCK: Must be upgraded through builder bot
            const freshBot = await firebaseRequest(`builder/bots/${botId}`);
            if (!freshBot?.is_upgraded) {
                await sendMsg(chatId, `⛔ <b>আপগ্রেড প্রয়োজন!</b>\n\nসোর্স নাম ও লিংক নিজের মতো পরিবর্তন করতে মেইন বিল্ডার বটে গিয়ে <b>Upgrade Branding</b> সম্পন্ন করুন।`, getAdminMenu());
                return;
            }
            const parts = text.split('|').map(s => s.trim());
            setSetting('custom_source_name', parts[0] || 'Custom Dev');
            setSetting('custom_source_link', parts[1] || `https://t.me/${botUsername}`);
            await sendMsg(chatId, `✅ কাস্টম সোর্স সফলভাবে আপডেট করা হয়েছে!`, getAdminMenu());
            return;
        }
    }

    // User State Handling: Withdraw Address
    if (!isAdm && cache.userStates.has(fromId)) {
        const uState = cache.userStates.get(fromId);
        if (uState.action === 'withdraw_address') {
            cache.userStates.delete(fromId);
            const fixedAmt = Number(getSetting('min_withdraw', 2));
            const coin = getSetting('coin_name', 'STAR');
            const curBal = Number(u.balance || 0);

            if (curBal < fixedAmt) {
                await sendMsg(chatId, `⚠️ অপর্যাপ্ত ব্যালেন্স! প্রয়োজন: <b>${fixedAmt} ${coin}</b>`, getUserMenu(fromId));
                return;
            }

            const txId = `${fromId}${Math.floor(Date.now() / 1000)}`;
            const wData = {
                user_id: fromId,
                first_name: msg.from.first_name || 'User',
                amount: fixedAmt,
                after_fee: fixedAmt,
                withdraw_address: text,
                transaction_id: txId,
                status: 'pending',
                created_at: Math.floor(Date.now() / 1000)
            };

            updateUser(fromId, { balance: curBal - fixedAmt });
            const saved = await childDb(botId, 'withdrawals', 'POST', wData);

            await sendMsg(chatId, `🔔 <b>Withdrawal Submitted!</b>\n\n💰 Amount: <b>${fixedAmt} ${coin}</b>\n📬 Address: <code>${escapeHtml(text)}</code>\n🧾 ID: <code>${txId}</code>`, getUserMenu(fromId));

            // Alert Child Super Admin
            if (saved?.name) {
                await sendMsg(superAdminId, `🔔 <b>New Withdrawal Alert!</b>\n👤 User: <code>${fromId}</code>\n💰 Amount: <b>${fixedAmt} ${coin}</b>\n📬 Send To: <code>${escapeHtml(text)}</code>`, {
                    inline_keyboard: [
                        [{ text: '✅ Approve', callback_data: `c_w_app_${saved.name}` }, { text: '❌ Reject', callback_data: `c_w_rej_${saved.name}` }]
                    ]
                });
            }
            return;
        }
    }

    // User Panel Features
    if (text === '👤 My Account') {
        const coin = getSetting('coin_name', 'STAR');
        await sendMsg(chatId, `👤 <b>MY ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 Name: <b>${escapeHtml(msg.from.first_name)}</b>\n🆔 ID: <code>${fromId}</code>\n⭐ Balance: <b>${formatNumber(u.balance || 0)} ${coin}</b>\n👥 Referrals: <b>${u.total_referrals || 0}</b>`, getUserMenu(fromId));
        return;
    }

    if (text === '📮 Referral') {
        const coin = getSetting('coin_name', 'STAR');
        const refBonus = getSetting('referral_bonus', 1);
        const refLink = `https://t.me/${botUsername}?start=${fromId}`;
        await sendMsg(chatId, `📮 <b>Referral Program</b>\n━━━━━━━━━━━━━━━━━━━━\n👥 Total Referrals: <b>${u.total_referrals || 0}</b>\n💰 Per Referral: <b>${refBonus} ${coin}</b>\n\n🔗 <b>Your Link:</b>\n<code>${refLink}</code>`, getUserMenu(fromId));
        return;
    }

    if (text === '💸 Withdraw') {
        const coin = getSetting('coin_name', 'STAR');
        const fixedAmt = Number(getSetting('min_withdraw', 2));
        if (Number(u.balance || 0) < fixedAmt) {
            await sendMsg(chatId, `⚠️ ব্যালেন্স কম!\nমিনিমাম উইথড্র: <b>${fixedAmt} ${coin}</b>\nআপনার ব্যালেন্স: <b>${formatNumber(u.balance || 0)} ${coin}</b>`);
            return;
        }
        cache.userStates.set(fromId, { action: 'withdraw_address' });
        await sendMsg(chatId, `💸 <b>উইথড্র করার এড্রেস বা একাউন্ট নাম্বার পাঠান:</b>`);
        return;
    }

    if (text === '📊 System Status') {
        const users = await childDb(botId, 'users') || {};
        const totalCount = Object.keys(users).length;
        const payouts = getSetting('custom_payouts_done', '0');
        const coin = getSetting('coin_name', 'STAR');

        // Dynamic Source attribution
        const freshBot = await firebaseRequest(`builder/bots/${botId}`);
        let sourceHtml = '';

        if (freshBot?.is_upgraded) {
            const sName = getSetting('custom_source_name', 'Verified Dev');
            const sLink = getSetting('custom_source_link', `https://t.me/${botUsername}`);
            sourceHtml = `<a href="${escapeHtml(sLink)}">${escapeHtml(sName)}</a>`;
        } else {
            // Default link to your main Builder Bot!
            sourceHtml = `<a href="https://t.me/${BUILDER_BOT_USERNAME}">${BUILDER_BOT_USERNAME}</a>`;
        }

        const stText = 
            `📡 <b>SYSTEM STATUS</b>\n━━━━━━━━━━━━━━━━━━\n` +
            `👥 <b>Total Users:</b> ${totalCount} Users\n\n` +
            `⭐ <b>Payouts Done:</b> ${escapeHtml(payouts)} ${coin}\n\n` +
            `🔧 <b>Source:</b> ${sourceHtml}`;

        await sendMsg(chatId, stText);
        return;
    }

    // Admin Panel Features
    if (isAdm) {
        if (text === '🛠 Admin Panel') {
            await sendMsg(chatId, '🛠 <b>Admin Panel Activated</b>', getAdminMenu());
            return;
        }
        if (text === '🔙 Back to User Panel') {
            await sendMsg(chatId, '👤 <b>User Panel</b>', getUserMenu(fromId));
            return;
        }
        if (text === '⚙️ Central Settings') {
            await sendMsg(chatId, '⚙️ <b>সেটিংস নির্বাচন করুন:</b>', {
                inline_keyboard: [
                    [{ text: '🪙 Coin Name', callback_data: 'cfg_coin' }],
                    [{ text: '💰 Fixed Min Withdraw', callback_data: 'cfg_withdraw' }],
                    [{ text: '👥 Referral Bonus', callback_data: 'cfg_referral' }]
                ]
            });
            return;
        }
        if (text === '⭐ সেট Payouts Done') {
            cache.adminStates.set(fromId, { action: 'set_payouts_done' });
            await sendMsg(chatId, '⭐ কত Payouts Done দেখাতে চান? সংখ্যা পাঠান:');
            return;
        }
        if (text === '🔧 Source Settings') {
            cache.adminStates.set(fromId, { action: 'set_source_info' });
            await sendMsg(chatId, '🔧 <b>সোর্স সেটিং:</b>\nলিখুন: <code>নাম | লিংক</code>\n\n<i>(নোট: আপগ্রেড না থাকলে পরিবর্তন কার্যকর হবে না)</i>');
            return;
        }
    }

    await sendMsg(chatId, `🌟 <b>Welcome ${escapeHtml(msg.from.first_name)}!</b>\nEarn rewards easily and withdraw directly.`, getUserMenu(fromId));
}

/*
|--------------------------------------------------------------------------
| 5. WEB SERVER & WEBHOOK MULTIPLEXER
|--------------------------------------------------------------------------
*/
const app = express();
app.use(express.json());

// Main Builder Bot Webhook
app.post('/webhook/builder', async (req, res) => {
    res.sendStatus(200);
    try {
        await handleBuilderUpdate(req.body);
    } catch (e) {
        console.error('Builder Hook Error:', e);
    }
});

// Multiplexed Child Bots Webhook
app.post('/webhook/child/:botId', async (req, res) => {
    res.sendStatus(200);
    const botId = req.params.botId;
    let botRecord = builderMemory.bots.get(botId);

    if (!botRecord) {
        botRecord = await firebaseRequest(`builder/bots/${botId}`);
        if (botRecord) builderMemory.bots.set(botId, botRecord);
    }

    if (botRecord) {
        try {
            await handleChildUpdate(botRecord, req.body);
        } catch (e) {
            console.error(`Child Bot (${botId}) Error:`, e);
        }
    }
});

app.get('/ping', (req, res) => res.send('Pong 🏓'));
app.get('/', (req, res) => res.send('Aura Bot Builder System is Running Live 🚀'));

// 24/7 Render Anti-Sleep Worker
setInterval(() => {
    fetch(`${APP_URL}/ping`).catch(() => {});
}, 8 * 60 * 1000);

// Initialize system on boot
async function initSystem() {
    console.log('⚡ Warming up Multi-Bot Builder Engine...');
    const allBots = await firebaseRequest('builder/bots') || {};
    for (const [id, b] of Object.entries(allBots)) {
        builderMemory.bots.set(id, b);
    }
    console.log(`✅ Loaded ${builderMemory.bots.size} child bots into memory.`);

    // Set Webhook for Builder Bot
    const bWh = `${APP_URL}/webhook/builder`;
    const setup = await telegramApi(BUILDER_BOT_TOKEN, 'setWebhook', { url: bWh, drop_pending_updates: true });
    console.log(`🤖 Builder Bot Webhook:`, setup);
}

const PORT = process.env.PORT || 8000;
app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    await initSystem();
});
