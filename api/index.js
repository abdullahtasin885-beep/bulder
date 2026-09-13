/*
|--------------------------------------------------------------------------
| TELEGRAM MULTI-BOT BUILDER PLATFORM (100% PRODUCTION READY & RESILIENT)
| - Builder Token: 8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo
| - Builder Username: @AuraBuilderProBot
| - Builder Super Admin: 8045367594
| - Dynamic Payment Methods per Child Bot (bKash, Nagad, Rocket, Crypto, etc.)
| - Strict Emoji-Resilient Button Engine
|--------------------------------------------------------------------------
*/

const express = require('express');

// ==========================================
// 1. SYSTEM CONFIGURATION
// ==========================================
const BUILDER_BOT_TOKEN = process.env.BUILDER_BOT_TOKEN || '8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo';
const BUILDER_BOT_USERNAME = 'AuraBuilderProBot';
const BUILDER_SUPER_ADMIN_ID = '8045367594';
const APP_URL = process.env.APP_URL || 'https://bulder.onrender.com';
const FIREBASE_DB_URL = 'https://bkas-45e17-default-rtdb.firebaseio.com';

const builderMemory = {
    states: new Map(),
    bots: new Map(),
    settings: {
        bkash: '01XXXXXXXXX',
        nagad: '01XXXXXXXXX',
        rocket: '01XXXXXXXXX',
        upgrade_fee: '150 BDT',
        support_url: 'https://t.me/AuraSupportsBot'
    }
};

const childCaches = new Map();

/*
|--------------------------------------------------------------------------
| 2. HELPERS & FORMATTERS
|--------------------------------------------------------------------------
*/
function escapeHtml(text) {
    if (typeof text !== 'string') text = String(text ?? '');
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanText(text) {
    if (typeof text !== 'string') return '';
    // Removes invisible Unicode variation selectors and trims
    return text.replace(/[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, '').trim();
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

function getCancelKeyboard() {
    return { keyboard: [[{ text: '❌ Cancel' }]], resize_keyboard: true, one_time_keyboard: true };
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
| 3. BUILDER BOT LOGIC
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
                `📱 <b>নগদ (Personal):</b> <code>${builderMemory.settings.nagad}</code>\n` +
                `📱 <b>রকেট (Personal):</b> <code>${builderMemory.settings.rocket}</code>\n\n` +
                `টাকা পাঠিয়ে আপনার <b>TrxID</b> এবং নাম্বারটি লিখে পাঠান:`;
            
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
                chat_id: fromId,
                text: payText,
                parse_mode: 'HTML',
                reply_markup: getCancelKeyboard()
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
                    text: `🎉 <b>অভিনন্দন!</b> আপনার বট <b>@${botData.bot_username}</b> এর কাস্টম ব্র্যান্ডিং অনুমোদন করা হয়েছে!\nএখন বটের এডমিন প্যানেল থেকে নিজের সোর্স ও লিংক সেট করতে পারবেন।`,
                    parse_mode: 'HTML'
                });
            }
            return;
        }
    }

    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const rawText = msg.text || '';
    const text = cleanText(rawText);

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
            parse_mode: 'HTML'
        });
        return;
    }

    if (text === 'Support') {
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `🎧 <b>Support Team:</b>\n${builderMemory.settings.support_url}`,
            parse_mode: 'HTML'
        });
        return;
    }

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

    if (text === 'Create Bot') {
        builderMemory.states.set(fromId, { step: 'awaiting_token' });
        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `🤖 <b>আপনার বট টোকেন দিন:</b>\n\n(@BotFather থেকে পাওয়া API Token পাঠান)`,
            parse_mode: 'HTML',
            reply_markup: getCancelKeyboard()
        });
        return;
    }

    if (curState?.step === 'awaiting_token') {
        const token = text.trim();
        if (!/^\d{8,11}:[A-Za-z0-9_-]{35}$/.test(token)) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: '❌ ভুল টোকেন! সঠিক Bot Token পাঠান:', reply_markup: getCancelKeyboard() });
            return;
        }

        const me = await telegramApi(token, 'getMe');
        if (!me.ok) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: `❌ টোকেন কাজ করছে না! Telegram: <i>${escapeHtml(me.description)}</i>\nসঠিক টোকেন পাঠান:`, reply_markup: getCancelKeyboard() });
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
            text: `✅ টোকেন ভেরিফাইড (বট: <b>@${me.result.username}</b>)!\n\nএখন বটের <b>ইউজারনেম</b> টি দিন (যেমন: <code>@${me.result.username}</code>):`,
            parse_mode: 'HTML',
            reply_markup: getCancelKeyboard()
        });
        return;
    }

    if (curState?.step === 'awaiting_username') {
        const uName = text.replace('@', '').trim();
        builderMemory.states.set(fromId, {
            ...curState,
            step: 'awaiting_admin_id',
            botUsername: uName
        });

        await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
            chat_id: fromId,
            text: `✅ ইউজারনেম গ্রহণ করা হয়েছে।\n\nএবার আপনার বটের <b>সুপার এডমিন আইডি (Numeric ID)</b> দিন:`,
            parse_mode: 'HTML',
            reply_markup: getCancelKeyboard()
        });
        return;
    }

    if (curState?.step === 'awaiting_admin_id') {
        if (!/^\d+$/.test(text)) {
            await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', { chat_id: fromId, text: '❌ সুপার এডমিন আইডি অবশ্যই সংখ্যা (Numeric) হতে হবে। আবার দিন:', reply_markup: getCancelKeyboard() });
            return;
        }

        const superAdminId = text;
        const botId = curState.botId;
        const childWebhookUrl = `${APP_URL}/webhook/child/${botId}`;

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

        // Default settings with payment methods
        await firebaseRequest(`bots/${botId}/settings`, 'PUT', {
            coin_name: 'STAR',
            min_withdraw: 2,
            referral_bonus: 1,
            welcome_bonus: 0,
            withdraw_fee_percent: 0,
            bot_power_status: 'on',
            payment_methods: ['bKash', 'Nagad', 'Rocket']
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

    await telegramApi(BUILDER_BOT_TOKEN, 'sendMessage', {
        chat_id: fromId,
        text: `🌟 <b>Welcome to ${escapeHtml(BUILDER_BOT_USERNAME)}!</b>\n\nনিচের মেনু ব্যবহার করুন:`,
        parse_mode: 'HTML',
        reply_markup: getBuilderMenu(fromId)
    });
}

/*
|--------------------------------------------------------------------------
| 4. CHILD BOT ENGINE (WITH CUSTOM PAYMENT METHODS & RESILIENT BUTTONS)
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
            paymentMethods: ['bKash', 'Nagad', 'Rocket'],
            botActive: true,
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

    const getMethods = async () => {
        const stored = await childDb(botId, 'settings/payment_methods');
        if (Array.isArray(stored) && stored.length > 0) {
            cache.paymentMethods = stored;
            return stored;
        }
        return cache.paymentMethods || ['bKash', 'Nagad', 'Rocket'];
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
                [{ text: '💳 Payment Methods' }, { text: '⭐ সেট Payouts Done' }],
                [{ text: '🔧 Source Settings' }, { text: '🔙 Back to User Panel' }]
            ],
            resize_keyboard: true
        };
    };

    // -------------------------------------------------------------
    // Inline Callbacks
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
            updateUser(fromId, { is_verified: true, verification_status: 'verified' });
            let u = await getUser(fromId);

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
            await sendMsg(fromId, '✅ <b>Verification Successful!</b>', getUserMenu(fromId));
            return;
        }

        // USER: Select Payment Method for withdrawal
        if (data.startsWith('w_method_')) {
            await ansCallback(cq.id);
            const selectedMethod = data.replace('w_method_', '');
            cache.userStates.set(fromId, { action: 'withdraw_address', method: selectedMethod });

            const coin = getSetting('coin_name', 'STAR');
            const fixedAmt = Number(getSetting('min_withdraw', 2));

            await sendMsg(fromId, 
                `💸 <b>Withdrawing via ${escapeHtml(selectedMethod)}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `💰 পরিমাণ: <b>${fixedAmt} ${escapeHtml(coin)}</b>\n\n` +
                `আপনার <b>${escapeHtml(selectedMethod)}</b> একাউন্ট নাম্বার বা ওয়ালেট এড্রেসটি লিখে পাঠান:`, 
                getCancelKeyboard()
            );
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
                sendMsg(wReq.user_id, `🎉 <b>Withdrawal Approved!</b>\n💰 Method: <b>${escapeHtml(wReq.method || 'N/A')}</b>\nAmount: <b>${wReq.after_fee} ${getSetting('coin_name', 'STAR')}</b>`);
                if (mid) editMsg(cid, mid, `✅ <b>Approved!</b>\nMethod: ${wReq.method || 'N/A'} | User: <code>${wReq.user_id}</code> | Amount: <b>${wReq.amount}</b>`);
            } else {
                const targetU = await getUser(wReq.user_id);
                updateUser(wReq.user_id, { balance: Number(targetU?.balance || 0) + Number(wReq.amount || 0) });
                await childDb(botId, `withdrawals/${wId}`, 'PATCH', { status: 'rejected', processed_at: now });
                sendMsg(wReq.user_id, `❌ <b>Withdrawal Rejected!</b>\n${wReq.amount} refunded.`);
                if (mid) editMsg(cid, mid, `❌ <b>Rejected!</b>\nUser: <code>${wReq.user_id}</code>`);
            }
            return;
        }

        // ADMIN: Payment Methods Management Callbacks
        if (isChildAdmin(fromId)) {
            if (data === 'pm_add') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'pm_add' });
                await sendMsg(fromId, `➕ <b>নতুন পেমেন্ট মেথড বা নেটওয়ার্ক যোগ:</b>\n\nমেথডের নাম লিখে পাঠান (যেমন: bKash, Nagad, Rocket, Binance, TRC20, ইত্যাদি):`, getCancelKeyboard());
                return;
            }

            if (data === 'pm_remove') {
                await ansCallback(cq.id);
                const methods = await getMethods();
                if (!methods.length) {
                    await sendMsg(fromId, '⚠️ কোনো মেথড নেই!');
                    return;
                }
                const delButtons = methods.map(m => [{ text: `❌ Delete ${m}`, callback_data: `pm_del_${m}` }]);
                await sendMsg(fromId, '🗑 <b>কোন মেথডটি রিমুভ করতে চান? ক্লিক করুন:</b>', { inline_keyboard: delButtons });
                return;
            }

            if (data.startsWith('pm_del_')) {
                const targetMethod = data.replace('pm_del_', '');
                let methods = await getMethods();
                methods = methods.filter(m => m !== targetMethod);
                cache.paymentMethods = methods;
                await childDb(botId, 'settings/payment_methods', 'PUT', methods);
                await ansCallback(cq.id, 'Removed!');
                await sendMsg(fromId, `✅ <b>${escapeHtml(targetMethod)}</b> মেথডটি সফলভাবে রিমুভ করা হয়েছে!`, getAdminMenu());
                return;
            }

            if (data === 'cfg_coin') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'cfg_coin' });
                const curCoin = getSetting('coin_name', 'STAR');
                await sendMsg(fromId, `🪙 <b>Coin / Currency Name</b>\n\nবর্তমান নাম: <b>${escapeHtml(curCoin)}</b>\n\nনতুন নাম পাঠান (যেমন: ৳, STAR, USDT):`, getCancelKeyboard());
                return;
            }

            if (data === 'cfg_withdraw') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'cfg_withdraw' });
                const curW = getSetting('min_withdraw', 2);
                const curCoin = getSetting('coin_name', 'STAR');
                await sendMsg(fromId, `💰 <b>Fixed Minimum Withdraw</b>\n\nবর্তমান পরিমাণ: <b>${curW} ${curCoin}</b>\n\nনতুন সংখ্যাটি লিখে পাঠান:`, getCancelKeyboard());
                return;
            }

            if (data === 'cfg_referral') {
                await ansCallback(cq.id);
                cache.adminStates.set(fromId, { action: 'cfg_referral' });
                const curR = getSetting('referral_bonus', 1);
                const curCoin = getSetting('coin_name', 'STAR');
                await sendMsg(fromId, `👥 <b>Referral Bonus</b>\n\nবর্তমান বোনাস: <b>${curR} ${curCoin}</b>\n\nনতুন সংখ্যাটি লিখে পাঠান:`, getCancelKeyboard());
                return;
            }
        }
    }

    // -------------------------------------------------------------
    // Messages Handling
    // -------------------------------------------------------------
    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const rawText = msg.text || '';
    const text = cleanText(rawText);
    const isAdm = isChildAdmin(fromId);

    // Cancel handling
    if (text === '❌ Cancel' || text === '/cancel') {
        cache.adminStates.delete(fromId);
        cache.userStates.delete(fromId);
        await sendMsg(chatId, '❌ বাতিল করা হয়েছে।', isAdm ? getAdminMenu() : getUserMenu(fromId));
        return;
    }

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

    // Clear state if any standard menu button was pressed
    if (text.includes('My Account') || text.includes('Referral') || text.includes('Withdraw') || 
        text.includes('History') || text.includes('System Status') || text.includes('Admin Panel') || 
        text.includes('Central Settings') || text.includes('Payment Methods') || text.includes('Payouts Done') || 
        text.includes('Source Settings') || text.includes('Back to User Panel')) {
        cache.adminStates.delete(fromId);
        cache.userStates.delete(fromId);
    }

    // Force Join Check
    if (!isAdm && !text.startsWith('/start')) {
        const joined = await isAllJoined(fromId);
        if (!joined) {
            const channels = Object.values(cache.forceChannels).filter(c => c && c.channel_link);
            const kb = channels.map(c => [{ text: c.channel_name || 'Join Channel', url: c.channel_link }]);
            kb.push([{ text: 'Claim / Verify ✅', callback_data: 'verify_join' }]);
            await sendMsg(chatId, `👋 <b>Hello ${escapeHtml(msg.from.first_name)}!</b>\n\nবট ব্যবহার করতে নিচের চ্যানেলে জয়েন করুন:`, { inline_keyboard: kb });
            return;
        }
    }

    // Admin State Inputs
    if (isAdm && cache.adminStates.has(fromId)) {
        const aState = cache.adminStates.get(fromId);

        if (aState.action === 'pm_add') {
            cache.adminStates.delete(fromId);
            const newMethod = text.trim();
            let methods = await getMethods();
            if (!methods.includes(newMethod)) {
                methods.push(newMethod);
                cache.paymentMethods = methods;
                await childDb(botId, 'settings/payment_methods', 'PUT', methods);
                await sendMsg(chatId, `✅ <b>${escapeHtml(newMethod)}</b> মেথডটি সফলভাবে যুক্ত হয়েছে!`, getAdminMenu());
            } else {
                await sendMsg(chatId, `⚠️ এই মেথডটি ইতিমধ্যে আছে!`, getAdminMenu());
            }
            return;
        }

        if (aState.action === 'cfg_coin') {
            cache.adminStates.delete(fromId);
            setSetting('coin_name', text.toUpperCase());
            await sendMsg(chatId, `✅ <b>Coin নাম পরিবর্তিত হয়েছে:</b> <b>${escapeHtml(text.toUpperCase())}</b>`, getAdminMenu());
            return;
        }

        if (aState.action === 'cfg_withdraw') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                cache.adminStates.delete(fromId);
                setSetting('min_withdraw', val);
                await sendMsg(chatId, `✅ <b>ফিক্সড উইথড্র সেট হয়েছে:</b> <b>${val}</b>`, getAdminMenu());
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }

        if (aState.action === 'cfg_referral') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0) {
                cache.adminStates.delete(fromId);
                setSetting('referral_bonus', val);
                await sendMsg(chatId, `✅ <b>রেফার বোনাস সেট হয়েছে:</b> <b>${val}</b>`, getAdminMenu());
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }

        if (aState.action === 'set_payouts_done') {
            cache.adminStates.delete(fromId);
            setSetting('custom_payouts_done', text);
            await sendMsg(chatId, `✅ <b>Payouts Done সেট হয়েছে:</b> <b>${escapeHtml(text)}</b>`, getAdminMenu());
            return;
        }

        if (aState.action === 'set_source_info') {
            cache.adminStates.delete(fromId);
            const freshBot = await firebaseRequest(`builder/bots/${botId}`);
            if (!freshBot?.is_upgraded) {
                await sendMsg(chatId, `⛔ <b>আপগ্রেড প্রয়োজন!</b>\n\nসোর্স নাম ও লিংক নিজের মতো পরিবর্তন করতে মেইন বিল্ডার বটে গিয়ে <b>Upgrade Branding</b> সম্পন্ন করুন।`, getAdminMenu());
                return;
            }
            const parts = text.split('|').map(s => s.trim());
            setSetting('custom_source_name', parts[0] || 'Custom Dev');
            setSetting('custom_source_link', parts[1] || `https://t.me/${botUsername}`);
            await sendMsg(chatId, `✅ <b>কাস্টম সোর্স সফলভাবে আপডেট করা হয়েছে!</b>`, getAdminMenu());
            return;
        }
    }

    // User State: Withdraw Address Input
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
                method: uState.method || 'General',
                withdraw_address: text,
                transaction_id: txId,
                status: 'pending',
                created_at: Math.floor(Date.now() / 1000)
            };

            updateUser(fromId, { balance: curBal - fixedAmt });
            const saved = await childDb(botId, 'withdrawals', 'POST', wData);

            await sendMsg(chatId, 
                `🔔 <b>Withdrawal Submitted!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `💳 Method: <b>${escapeHtml(uState.method || 'General')}</b>\n` +
                `💰 Amount: <b>${fixedAmt} ${coin}</b>\n` +
                `📬 Address: <code>${escapeHtml(text)}</code>\n` +
                `🧾 ID: <code>${txId}</code>`, 
                getUserMenu(fromId)
            );

            if (saved?.name) {
                await sendMsg(superAdminId, 
                    `🔔 <b>New Withdrawal Alert!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 User: <code>${fromId}</code>\n` +
                    `💳 Method: <b>${escapeHtml(uState.method || 'General')}</b>\n` +
                    `💰 Amount: <b>${fixedAmt} ${coin}</b>\n` +
                    `📬 Send To: <code>${escapeHtml(text)}</code>`, 
                    {
                        inline_keyboard: [
                            [{ text: '✅ Approve', callback_data: `c_w_app_${saved.name}` }, { text: '❌ Reject', callback_data: `c_w_rej_${saved.name}` }]
                        ]
                    }
                );
            }
            return;
        }
    }

    // ==========================================
    // RESILIENT USER MENU MATCHING
    // ==========================================
    if (text.startsWith('/start')) {
        await sendMsg(chatId, `🌟 <b>Welcome ${escapeHtml(msg.from.first_name)}!</b>\n\nEarn rewards easily and withdraw directly.`, getUserMenu(fromId));
        return;
    }

    if (text.includes('My Account')) {
        const coin = getSetting('coin_name', 'STAR');
        await sendMsg(chatId, `👤 <b>MY ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 Name: <b>${escapeHtml(msg.from.first_name)}</b>\n🆔 ID: <code>${fromId}</code>\n⭐ Balance: <b>${formatNumber(u.balance || 0)} ${coin}</b>\n👥 Referrals: <b>${u.total_referrals || 0}</b>`, getUserMenu(fromId));
        return;
    }

    if (text.includes('Referral')) {
        const coin = getSetting('coin_name', 'STAR');
        const refBonus = getSetting('referral_bonus', 1);
        const refLink = `https://t.me/${botUsername}?start=${fromId}`;
        await sendMsg(chatId, `📮 <b>Referral Program</b>\n━━━━━━━━━━━━━━━━━━━━\n👥 Total Referrals: <b>${u.total_referrals || 0}</b>\n💰 Per Referral: <b>${refBonus} ${coin}</b>\n\n🔗 <b>Your Link:</b>\n<code>${refLink}</code>`, getUserMenu(fromId));
        return;
    }

    if (text.includes('Withdraw')) {
        const coin = getSetting('coin_name', 'STAR');
        const fixedAmt = Number(getSetting('min_withdraw', 2));
        if (Number(u.balance || 0) < fixedAmt) {
            await sendMsg(chatId, `⚠️ ব্যালেন্স কম!\nমিনিমাম উইথড্র: <b>${fixedAmt} ${coin}</b>\nআপনার ব্যালেন্স: <b>${formatNumber(u.balance || 0)} ${coin}</b>`);
            return;
        }

        const methods = await getMethods();
        const kb = [];
        for (let i = 0; i < methods.length; i += 2) {
            if (i + 1 < methods.length) {
                kb.push([
                    { text: methods[i], callback_data: `w_method_${methods[i]}` },
                    { text: methods[i + 1], callback_data: `w_method_${methods[i + 1]}` }
                ]);
            } else {
                kb.push([{ text: methods[i], callback_data: `w_method_${methods[i]}` }]);
            }
        }

        await sendMsg(chatId, `💸 <b>উইথড্র করার পেমেন্ট মেথড নির্বাচন করুন:</b>`, { inline_keyboard: kb });
        return;
    }

    if (text.includes('History')) {
        const allW = await childDb(botId, 'withdrawals') || {};
        const myW = Object.values(allW).filter(w => String(w.user_id) === fromId);
        if (!myW.length) {
            await sendMsg(chatId, '📜 কোনো উইথড্র রেকর্ড পাওয়া যায়নি।');
            return;
        }
        let out = `📜 <b>YOUR WITHDRAWAL HISTORY:</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const item of myW.slice(-5).reverse()) {
            out += `• <b>${item.status.toUpperCase()}</b> | ${item.amount} ${getSetting('coin_name', 'STAR')} via ${item.method || 'General'}\n  🕒 ${formatTimestamp(item.created_at)}\n`;
        }
        await sendMsg(chatId, out);
        return;
    }

    if (text.includes('System Status')) {
        const users = await childDb(botId, 'users') || {};
        const totalCount = Object.keys(users).length;
        const payouts = getSetting('custom_payouts_done', '0');
        const coin = getSetting('coin_name', 'STAR');

        const freshBot = await firebaseRequest(`builder/bots/${botId}`);
        let sourceHtml = '';

        if (freshBot?.is_upgraded) {
            const sName = getSetting('custom_source_name', 'Verified Dev');
            const sLink = getSetting('custom_source_link', `https://t.me/${botUsername}`);
            sourceHtml = `<a href="${escapeHtml(sLink)}">${escapeHtml(sName)}</a>`;
        } else {
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

    // ==========================================
    // RESILIENT ADMIN MENU MATCHING
    // ==========================================
    if (isAdm) {
        if (text.includes('Admin Panel')) {
            await sendMsg(chatId, '🛠 <b>Admin Panel Activated</b>', getAdminMenu());
            return;
        }
        if (text.includes('Back to User Panel')) {
            await sendMsg(chatId, '👤 <b>User Panel</b>', getUserMenu(fromId));
            return;
        }
        if (text.includes('Payment Methods')) {
            const methods = await getMethods();
            let mList = methods.map((m, i) => `${i + 1}. <b>${escapeHtml(m)}</b>`).join('\n');
            await sendMsg(chatId, 
                `💳 <b>PAYMENT METHODS MANAGEMENT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                `বর্তমান সক্রিয় মেথড:\n${mList || 'কোনো মেথড যোগ করা নেই'}\n\n` +
                `নিচের বাটন দিয়ে নতুন মেথড যোগ বা ডিলিট করুন:`,
                {
                    inline_keyboard: [
                        [{ text: '➕ Add Method', callback_data: 'pm_add' }],
                        [{ text: '➖ Remove Method', callback_data: 'pm_remove' }]
                    ]
                }
            );
            return;
        }
        if (text.includes('Central Settings')) {
            await sendMsg(chatId, '⚙️ <b>সেটিংস নির্বাচন করুন:</b>', {
                inline_keyboard: [
                    [{ text: '🪙 Coin Name', callback_data: 'cfg_coin' }],
                    [{ text: '💰 Fixed Min Withdraw', callback_data: 'cfg_withdraw' }],
                    [{ text: '👥 Referral Bonus', callback_data: 'cfg_referral' }]
                ]
            });
            return;
        }
        if (text.includes('Payouts Done')) {
            cache.adminStates.set(fromId, { action: 'set_payouts_done' });
            const curP = getSetting('custom_payouts_done', '0');
            await sendMsg(chatId, `⭐ <b>Payouts Done নির্ধারণ</b>\n\nবর্তমান মান: <b>${escapeHtml(curP)}</b>\n\nনতুন সংখ্যাটি লিখে পাঠান:`, getCancelKeyboard());
            return;
        }
        if (text.includes('Source Settings')) {
            cache.adminStates.set(fromId, { action: 'set_source_info' });
            await sendMsg(chatId, '🔧 <b>সোর্স সেটিং:</b>\nলিখুন: <code>নাম | লিংক</code>\n\n<i>(নোট: শুধুমাত্র পেইড আপগ্রেড করা থাকলে কার্যকর হবে)</i>', getCancelKeyboard());
            return;
        }
    }

    // Default Fallback
    await sendMsg(chatId, `🌟 <b>Welcome ${escapeHtml(msg.from.first_name)}!</b>\nEarn rewards easily and withdraw directly.`, getUserMenu(fromId));
}

/*
|--------------------------------------------------------------------------
| 5. WEB SERVER & WEBHOOK MULTIPLEXER
|--------------------------------------------------------------------------
*/
const app = express();
app.use(express.json());

app.post('/webhook/builder', async (req, res) => {
    res.sendStatus(200);
    try {
        await handleBuilderUpdate(req.body);
    } catch (e) {
        console.error('Builder Hook Error:', e);
    }
});

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

setInterval(() => {
    fetch(`${APP_URL}/ping`).catch(() => {});
}, 8 * 60 * 1000);

async function initSystem() {
    console.log('⚡ Warming up Multi-Bot Builder Engine...');
    const allBots = await firebaseRequest('builder/bots') || {};
    for (const [id, b] of Object.entries(allBots)) {
        builderMemory.bots.set(id, b);
    }
    console.log(`✅ Loaded ${builderMemory.bots.size} child bots into memory.`);

    const bWh = `${APP_URL}/webhook/builder`;
    const setup = await telegramApi(BUILDER_BOT_TOKEN, 'setWebhook', { url: bWh, drop_pending_updates: true });
    console.log(`🤖 Builder Bot Webhook:`, setup);
}

const PORT = process.env.PORT || 8000;
app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    await initSystem();
});
