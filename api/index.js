/*
|--------------------------------------------------------------------------
| TELEGRAM DIRECT STANDALONE EARNING BOT SUITE
| - All Admin Tools + Central Settings + Payment Methods
| - Force Channels + Security & Whitelist Engine
| - Firebase Realtime Database Integration
|--------------------------------------------------------------------------
*/

const express = require('express');

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN || '8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo';
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || '8045367594';
const APP_URL = process.env.APP_URL || 'https://bulder.onrender.com';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://bkas-45e17-default-rtdb.firebaseio.com';

let BOT_USERNAME = '';
let BOT_ID = '';

// In-Memory Fast Cache
const cache = {
    users: new Map(),
    settings: new Map(),
    forceChannels: {},
    admins: {},
    blacklist: {},
    whitelist: {},
    paymentMethods: ['bKash', 'Nagad', 'Rocket'],
    botActive: true,
    whitelistOnly: false,
    adminStates: new Map(),
    userStates: new Map(),
    _loaded: false
};

/*
|--------------------------------------------------------------------------
| 2. HELPERS & UTILITIES
|--------------------------------------------------------------------------
*/
function escapeHtml(text) {
    if (typeof text !== 'string') text = String(text ?? '');
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanText(text) {
    if (typeof text !== 'string') return '';
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

function getCommand(rawText) {
    const s = cleanText(rawText).toLowerCase();
    if (s.startsWith('/start')) return 'start';
    if (s === '❌ cancel' || s === '/cancel') return 'cancel';
    if (s.includes('my account') || s.includes('account')) return 'account';
    if (s.includes('referral')) return 'referral';
    if (s.includes('withdraw')) return 'withdraw';
    if (s.includes('history')) return 'history';
    if (s.includes('system status') || s.includes('status')) return 'status';
    if (s.includes('admin panel')) return 'admin_panel';
    if (s.includes('back to user panel')) return 'back_user';
    if (s.includes('central settings')) return 'central_settings';
    if (s.includes('user & balance')) return 'user_balance';
    if (s.includes('channel broadcast')) return 'channel_broadcast';
    if (s.includes('users broadcast')) return 'users_broadcast';
    if (s.includes('security')) return 'security';
    if (s.includes('force channels')) return 'force_channels';
    if (s.includes('payouts done')) return 'payouts_done';
    if (s.includes('payment methods')) return 'payment_methods';
    if (s.includes('source settings')) return 'source_settings';
    if (s.includes('এডমিন ম্যানেজমেন্ট') || s.includes('admin management')) return 'admin_management';
    if (s.includes('active (on)') || s.includes('bot: off') || s.includes('maintenance')) return 'bot_power';
    return 'text';
}

/*
|--------------------------------------------------------------------------
| 3. DATABASE (FIREBASE) & TELEGRAM API
|--------------------------------------------------------------------------
*/
async function db(path, method = 'GET', data = null) {
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

async function telegramApi(method, params = {}) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
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

async function sendMsg(cid, txt, rm = null) {
    let res = await telegramApi('sendMessage', {
        chat_id: cid, text: txt, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: rm
    });
    if (!res?.ok && res?.description && res.description.includes('can\'t parse entities')) {
        res = await telegramApi('sendMessage', {
            chat_id: cid, text: txt.replace(/<[^>]*>?/gm, ''), disable_web_page_preview: true, reply_markup: rm
        });
    }
    return res;
}

async function editMsg(cid, mid, txt, rm = null) {
    return await telegramApi('editMessageText', {
        chat_id: cid, message_id: mid, text: txt, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: rm
    });
}

async function copyMsg(toChatId, fromChatId, messageId, rm = null) {
    return await telegramApi('copyMessage', {
        chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId, reply_markup: rm
    });
}

// Ensure Cache Warmup
async function ensureCacheLoaded() {
    if (cache._loaded) return;
    try {
        const [settings, admins, forceCh, bl, wl, methods] = await Promise.all([
            db('settings'),
            db('admins'),
            db('force_channels'),
            db('security/blacklist'),
            db('security/whitelist'),
            db('settings/payment_methods')
        ]);

        if (settings && typeof settings === 'object') {
            for (const [k, v] of Object.entries(settings)) cache.settings.set(k, v);
            cache.botActive = settings.bot_power_status !== 'off';
            cache.whitelistOnly = settings.whitelist_only_mode === 'on';
        }
        if (admins && typeof admins === 'object') cache.admins = admins;
        if (forceCh && typeof forceCh === 'object') cache.forceChannels = forceCh;
        if (bl && typeof bl === 'object') cache.blacklist = bl;
        if (wl && typeof wl === 'object') cache.whitelist = wl;
        if (Array.isArray(methods) && methods.length > 0) cache.paymentMethods = methods;
        cache._loaded = true;
    } catch (e) {
        console.error('Cache Load Error:', e.message);
    }
}

async function verifyChannelAndBotAdmin(targetInput) {
    let normalized = cleanText(targetInput);
    if (!normalized) return { ok: false, error: "❌ সঠিক Channel ID বা Username দিন।" };
    if (!normalized.startsWith('-100') && !normalized.startsWith('@')) {
        const linkMatch = normalized.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]{4,32})/i);
        if (linkMatch) normalized = '@' + linkMatch[1];
        else if (/^[A-Za-z0-9_]{4,32}$/.test(normalized)) normalized = '@' + normalized;
    }

    const chatRes = await telegramApi('getChat', { chat_id: normalized });
    if (!chatRes?.ok || !chatRes.result) {
        return { ok: false, error: "❌ চ্যানেলটি পাওয়া যায়নি! ইউজারনেম সঠিক কিনা এবং বট চ্যানেলে যুক্ত আছে কিনা নিশ্চিত করুন।" };
    }

    const chat = chatRes.result;
    const memberRes = await telegramApi('getChatMember', { chat_id: chat.id, user_id: BOT_ID });

    if (!memberRes?.ok || !['administrator', 'creator'].includes(memberRes.result?.status)) {
        return { ok: false, error: `❌ বট <b>${escapeHtml(chat.title || 'Channel')}</b> চ্যানেলে এডমিন নয়! দয়া করে এডমিন পারমিশন দিন।` };
    }

    return {
        ok: true,
        channel_id: String(chat.id),
        channel_title: chat.title || 'Channel',
        channel_link: chat.username ? `https://t.me/${chat.username}` : (chat.invite_link || `https://t.me/${chat.id}`)
    };
}

/*
|--------------------------------------------------------------------------
| 4. MENUS & KEYBOARDS
|--------------------------------------------------------------------------
*/
function getUserMenu(isAdmin) {
    const kb = [
        [{ text: '👤 My Account' }, { text: '📮 Referral' }],
        [{ text: '💸 Withdraw' }, { text: '📜 History' }],
        [{ text: '📊 System Status' }]
    ];
    if (isAdmin) kb.push([{ text: '🛠 Admin Panel' }]);
    return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}

function getFullAdminMenu(botActive, wlMode, isSuperAdmin) {
    const kb = [
        [
            { text: botActive ? '🟢 Bot: Active (ON)' : '🔴 Bot: OFF (Maintenance)' },
            { text: '⚙️ Central Settings' }
        ],
        [
            { text: '👥 User & Balance' },
            { text: '📢 Channel Broadcast' }
        ],
        [
            { text: '📢 Users Broadcast' },
            { text: `🛡️ Security (${wlMode ? 'Whitelist' : 'Standard'})` }
        ],
        [
            { text: '📢 Force Channels' },
            { text: '⭐ সেট Payouts Done' }
        ],
        [
            { text: '💳 Payment Methods' },
            { text: '🔧 Source Settings' }
        ]
    ];
    if (isSuperAdmin) {
        kb.push([{ text: '👮 এডমিন ম্যানেজমেন্ট' }]);
    }
    kb.push([{ text: '🔙 Back to User Panel' }]);
    return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}

function centralSettingsKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 জয়েন বট লিংক', callback_data: 'cfg_join_bot' }, { text: '🎧 Support Bot Link', callback_data: 'cfg_support' }],
            [{ text: '💳 Payment Channel', callback_data: 'cfg_pay_channel' }, { text: '🪙 Coin Name', callback_data: 'cfg_coin' }],
            [{ text: '👥 Referral Reward', callback_data: 'cfg_referral' }, { text: '💰 Fixed Withdraw', callback_data: 'cfg_withdraw' }],
            [{ text: '🎯 1st Withdraw Refs', callback_data: 'cfg_first_refs' }, { text: '🎁 Welcome Bonus', callback_data: 'cfg_welcome' }],
            [{ text: '📊 Withdraw Fee (%)', callback_data: 'cfg_fee' }]
        ]
    };
}

function securityKeyboard(wlMode) {
    return {
        inline_keyboard: [
            [{ text: wlMode ? '🔒 Mode: Whitelist Only' : '🔓 Mode: Standard (All allowed)', callback_data: 'sec_toggle_wl' }],
            [{ text: '🚫 Add Blacklist', callback_data: 'sec_add_bl' }, { text: '✅ Add Whitelist', callback_data: 'sec_add_wl' }],
            [{ text: '❌ Remove Blacklist', callback_data: 'sec_rem_bl' }, { text: '❌ Remove Whitelist', callback_data: 'sec_rem_wl' }],
            [{ text: '📋 Blacklist Users', callback_data: 'sec_list_bl' }, { text: '📋 Whitelist Users', callback_data: 'sec_list_wl' }]
        ]
    };
}

/*
|--------------------------------------------------------------------------
| 5. BOT UPDATE HANDLER (CORE ENGINE)
|--------------------------------------------------------------------------
*/
async function handleUpdate(update) {
    await ensureCacheLoaded();

    const isChildAdmin = (uid) => String(uid) === SUPER_ADMIN_ID || Boolean(cache.admins[String(uid)]?.active);
    const isSuperAdmin = (uid) => String(uid) === SUPER_ADMIN_ID;

    const getSetting = (k, def = '') => cache.settings.has(k) ? cache.settings.get(k) : def;
    const setSetting = (k, v) => {
        cache.settings.set(k, v);
        if (k === 'bot_power_status') cache.botActive = v !== 'off';
        if (k === 'whitelist_only_mode') cache.whitelistOnly = v === 'on';
        db(`settings/${k}`, 'PUT', v);
    };

    const getUser = async (uid) => {
        const uKey = String(uid);
        if (cache.users.has(uKey)) return cache.users.get(uKey);
        const res = await db(`users/${uKey}`);
        if (res) cache.users.set(uKey, res);
        return res;
    };

    const updateUser = (uid, data) => {
        const uKey = String(uid);
        const cur = cache.users.get(uKey) || {};
        const up = { ...cur, ...data };
        cache.users.set(uKey, up);
        db(`users/${uKey}`, 'PATCH', data);
    };

    const isJoined = async (chId, uid) => {
        const res = await telegramApi('getChatMember', { chat_id: chId, user_id: uid });
        return res?.ok && ['creator', 'administrator', 'member', 'restricted'].includes(res.result?.status);
    };

    const isAllJoined = async (uid) => {
        const channels = Object.values(cache.forceChannels).filter(c => c && c.channel_id);
        if (!channels.length) return true;
        const res = await Promise.all(channels.map(c => isJoined(c.channel_id, uid)));
        return res.every(Boolean);
    };

    // -------------------------------------------------------------
    // CALLBACK QUERIES
    // -------------------------------------------------------------
    if (update.callback_query) {
        const cq = update.callback_query;
        const fromId = String(cq.from.id);
        const data = cq.data || '';
        const cid = cq.message?.chat?.id;
        const mid = cq.message?.message_id;

        // Force Join Verify
        if (data === 'verify_join') {
            await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
            const ok = await isAllJoined(fromId);
            if (!ok) {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ আপনি সব চ্যানেলে জয়েন করেননি!', show_alert: true });
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

            if (mid) await telegramApi('deleteMessage', { chat_id: cid, message_id: mid });
            await sendMsg(fromId, `✅ <b>Verification Successful!</b>\nWelcome to @${BOT_USERNAME}!`, getUserMenu(isChildAdmin(fromId)));
            return;
        }

        // USER: Select Payment Method for withdrawal
        if (data.startsWith('w_method_')) {
            await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
            const selectedMethod = data.replace('w_method_', '');
            cache.userStates.set(fromId, { action: 'withdraw_address', method: selectedMethod });

            const coin = getSetting('coin_name', 'STAR');
            const fixedAmt = Number(getSetting('min_withdraw', 2));

            await sendMsg(fromId, 
                `💸 <b>Withdrawing via ${escapeHtml(selectedMethod)}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `💰 পরিমাণ: <b>${fixedAmt} ${escapeHtml(coin)}</b>\n\n` +
                `আপনার <b>${escapeHtml(selectedMethod)}</b> নাম্বার বা ওয়ালেট এড্রেসটি লিখে পাঠান:`, 
                getCancelKeyboard()
            );
            return;
        }

        // ADMIN: Withdraw Approvals
        if (data.startsWith('c_w_app_') || data.startsWith('c_w_rej_')) {
            await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
            if (!isChildAdmin(fromId)) return;

            const isApprove = data.startsWith('c_w_app_');
            const wId = data.replace(isApprove ? 'c_w_app_' : 'c_w_rej_', '');
            const wReq = await db(`withdrawals/${wId}`);

            if (!wReq || wReq.status !== 'pending') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ Already processed!', show_alert: true });
                return;
            }

            const now = Math.floor(Date.now() / 1000);
            if (isApprove) {
                await db(`withdrawals/${wId}`, 'PATCH', { status: 'approved', processed_at: now });
                updateUser(wReq.user_id, { has_withdrawn: true });
                sendMsg(wReq.user_id, `🎉 <b>Withdrawal Approved!</b>\n💰 Method: <b>${escapeHtml(wReq.method || 'General')}</b>\nAmount: <b>${wReq.after_fee} ${getSetting('coin_name', 'STAR')}</b>`);
                if (mid) editMsg(cid, mid, `✅ <b>Approved!</b>\nMethod: ${wReq.method || 'N/A'} | User: <code>${wReq.user_id}</code> | Amount: <b>${wReq.amount}</b>`);
            } else {
                const targetU = await getUser(wReq.user_id);
                updateUser(wReq.user_id, { balance: Number(targetU?.balance || 0) + Number(wReq.amount || 0) });
                await db(`withdrawals/${wId}`, 'PATCH', { status: 'rejected', processed_at: now });
                sendMsg(wReq.user_id, `❌ <b>Withdrawal Rejected!</b>\n${wReq.amount} refunded.`);
                if (mid) editMsg(cid, mid, `❌ <b>Rejected!</b>\nUser: <code>${wReq.user_id}</code>`);
            }
            return;
        }

        // ADMIN: Central Settings Callbacks
        if (isChildAdmin(fromId)) {
            if (data === 'cfg_join_bot') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_join_bot' });
                await sendMsg(fromId, `🚀 <b>জয়েন বট লিংক</b>\nনতুন লিংক লিখে পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_support') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_support' });
                await sendMsg(fromId, `🎧 <b>Support Bot Link</b>\nনতুন লিংক বা ইউজারনেম পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_pay_channel') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_pay_channel' });
                await sendMsg(fromId, `💳 <b>Payment Request Channel</b>\nচ্যানেল আইডি (যেমন: <code>-100...</code>) বা ইউজারনেম পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_coin') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_coin' });
                await sendMsg(fromId, `🪙 <b>Coin / Currency Name</b>\nবর্তমান নাম: <b>${getSetting('coin_name', 'STAR')}</b>\nনতুন নাম পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_referral') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_referral' });
                await sendMsg(fromId, `👥 <b>Referral Bonus</b>\nনতুন রিওয়ার্ডের পরিমাণ পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_withdraw') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_withdraw' });
                await sendMsg(fromId, `💰 <b>Fixed Minimum Withdraw</b>\nনতুন পরিমাণ পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_first_refs') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_first_refs' });
                await sendMsg(fromId, `🎯 <b>1st Withdraw Referral Requirement</b>\nপ্রথম উইথড্রতে কয়টি রেফার প্রয়োজন? সংখ্যা পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_welcome') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_welcome' });
                await sendMsg(fromId, `🎁 <b>Welcome Bonus</b>\nনতুন পরিমাণ পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_fee') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_fee' });
                await sendMsg(fromId, `📊 <b>Withdraw Fee (%)</b>\nনতুন পার্সেন্টেজ লিখুন (0-100):`, getCancelKeyboard());
                return;
            }

            // Payment Methods Callbacks
            if (data === 'pm_add') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'pm_add' });
                await sendMsg(fromId, `➕ <b>নতুন পেমেন্ট মেথড যোগ:</b>\nমেথডের নাম লিখে পাঠান (যেমন: bKash, Nagad, Rocket, Binance, TRC20):`, getCancelKeyboard());
                return;
            }
            if (data === 'pm_remove') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                const methods = cache.paymentMethods || [];
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
                let methods = (cache.paymentMethods || []).filter(m => m !== targetMethod);
                cache.paymentMethods = methods;
                await db('settings/payment_methods', 'PUT', methods);
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Removed!' });
                await sendMsg(fromId, `✅ <b>${escapeHtml(targetMethod)}</b> রিমুভ করা হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuperAdmin(fromId)));
                return;
            }

            // Security Callbacks
            if (data === 'sec_toggle_wl') {
                const newMode = cache.whitelistOnly ? 'off' : 'on';
                setSetting('whitelist_only_mode', newMode);
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: `Mode: ${newMode.toUpperCase()}` });
                if (mid) editMsg(cid, mid, "🛡️ <b>Security Management</b>", securityKeyboard(newMode === 'on'));
                return;
            }
            if (data === 'sec_add_bl') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_add_bl' });
                await sendMsg(fromId, "🚫 <b>Add to Blacklist</b>\nইউজারের Numeric Telegram ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_add_wl') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_add_wl' });
                await sendMsg(fromId, "✅ <b>Add to Whitelist</b>\nইউজারের Numeric Telegram ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_rem_bl') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_rem_bl' });
                await sendMsg(fromId, "❌ <b>Remove Blacklist</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_rem_wl') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_rem_wl' });
                await sendMsg(fromId, "❌ <b>Remove Whitelist</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_list_bl') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                const ids = Object.keys(cache.blacklist || {});
                await sendMsg(fromId, `🚫 <b>Blacklist (${ids.length}):</b>\n` + (ids.length ? ids.map(id => `• <code>${id}</code>`).join('\n') : 'তালিকা খালি।'));
                return;
            }
            if (data === 'sec_list_wl') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                const ids = Object.keys(cache.whitelist || {});
                await sendMsg(fromId, `✅ <b>Whitelist (${ids.length}):</b>\n` + (ids.length ? ids.map(id => `• <code>${id}</code>`).join('\n') : 'তালিকা খালি।'));
                return;
            }

            // Force Channels Callbacks
            if (data === 'fc_add') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'fc_add' });
                await sendMsg(fromId, "➕ <b>ফোর্স চ্যানেল যোগ:</b>\nচ্যানেল আইডি (<code>-100...</code>) বা ইউজারনেম পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'fc_remove') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                const entries = Object.entries(cache.forceChannels || {});
                if (!entries.length) {
                    await sendMsg(fromId, "⚠️ কোনো চ্যানেল তালিকায় নেই!");
                    return;
                }
                const kb = entries.map(([k, c]) => [{ text: `❌ ${c.channel_name || 'Channel'}`, callback_data: `fc_del_${k}` }]);
                await sendMsg(fromId, "📢 <b>রিমুভ করতে চ্যানেল নির্বাচন করুন:</b>", { inline_keyboard: kb });
                return;
            }
            if (data.startsWith('fc_del_')) {
                const k = data.replace('fc_del_', '');
                delete cache.forceChannels[k];
                await db(`force_channels/${k}`, 'DELETE');
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Deleted!' });
                await sendMsg(fromId, "✅ চ্যানেল সফলভাবে রিমুভ হয়েছে!", getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuperAdmin(fromId)));
                return;
            }
            if (data === 'fc_list') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                const channels = Object.values(cache.forceChannels || {});
                let list = `📢 <b>ফোর্স চ্যানেল তালিকা (${channels.length})</b>\n━━━━━━━━━━━━━━━━━━\n`;
                if (!channels.length) list += "\nকোনো Force Join Channel নেই।";
                else {
                    for (const c of channels) {
                        list += `\n🔹 <b>${escapeHtml(c.channel_name || '')}</b>\n🆔 <code>${c.channel_id}</code>\n🔗 ${c.channel_link}\n`;
                    }
                }
                await sendMsg(fromId, list);
                return;
            }

            // Balance Callbacks
            if (data === 'bal_add') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'bal_add_user' });
                await sendMsg(fromId, "➕ <b>ব্যালেন্স যোগ:</b>\nইউজারের Telegram User ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'bal_cut') {
                await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'bal_cut_user' });
                await sendMsg(fromId, "➖ <b>ব্যালেন্স কাটুন:</b>\nইউজারের Telegram User ID পাঠান:", getCancelKeyboard());
                return;
            }

            // Admin Management Callbacks
            if (isSuperAdmin(fromId)) {
                if (data === 'adm_add') {
                    await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                    cache.adminStates.set(fromId, { action: 'adm_add' });
                    await sendMsg(fromId, "➕ <b>নতুন এডমিন যোগ:</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                    return;
                }
                if (data === 'adm_rem') {
                    await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                    cache.adminStates.set(fromId, { action: 'adm_rem' });
                    await sendMsg(fromId, "➖ <b>এডমিন রিমুভ:</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                    return;
                }
                if (data === 'adm_list') {
                    await telegramApi('answerCallbackQuery', { callback_query_id: cq.id });
                    let list = `👮 <b>এডমিন তালিকা</b>\n━━━━━━━━━━━━━━━━━━\n👑 Super Admin: <code>${SUPER_ADMIN_ID}</code>\n\n`;
                    for (const [aId, a] of Object.entries(cache.admins || {})) {
                        if (a?.active) list += `• <code>${aId}</code>\n`;
                    }
                    await sendMsg(fromId, list);
                    return;
                }
            }
        }
    }

    // -------------------------------------------------------------
    // MESSAGES
    // -------------------------------------------------------------
    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const rawText = msg.text || '';
    const text = cleanText(rawText);
    const cmd = getCommand(rawText);
    const isAdm = isChildAdmin(fromId);
    const isSuper = isSuperAdmin(fromId);

    // Initial Registration
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

    // Cancel Action
    if (cmd === 'cancel') {
        cache.adminStates.delete(fromId);
        cache.userStates.delete(fromId);
        await sendMsg(chatId, '❌ Cancelled.', isAdm ? getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper) : getUserMenu(isAdm));
        return;
    }

    // If any menu button was pressed, auto-clear pending inputs
    if (cmd !== 'text') {
        cache.adminStates.delete(fromId);
        cache.userStates.delete(fromId);
    }

    // Security Gate Check (Blacklist & Whitelist)
    if (!isAdm) {
        if (cache.blacklist && cache.blacklist[fromId]) {
            await sendMsg(chatId, "⛔ <b>Access Blocked!</b>\nYour account has been restricted.");
            return;
        }
        if (cache.whitelistOnly && (!cache.whitelist || !cache.whitelist[fromId])) {
            await sendMsg(chatId, "⛔ <b>Whitelist Only Mode Active!</b>\nAccess is currently restricted.");
            return;
        }
        if (!cache.botActive) {
            await sendMsg(chatId, "⛔ <b>Bot currently off for maintenance!</b>");
            return;
        }
    }

    // Strict Force Join Check (Except /start)
    if (!isAdm && cmd !== 'start') {
        const joined = await isAllJoined(fromId);
        if (!joined) {
            const channels = Object.values(cache.forceChannels || {}).filter(c => c && c.channel_link);
            const kb = channels.map(c => [{ text: c.channel_name || 'Join Channel', url: c.channel_link }]);
            kb.push([{ text: 'Claim / Verify ✅', callback_data: 'verify_join' }]);
            await sendMsg(chatId, `👋 <b>Hello ${escapeHtml(msg.from.first_name)}!</b>\n\nবট ব্যবহার করতে নিচের সকল চ্যানেলে জয়েন করুন:`, { inline_keyboard: kb });
            return;
        }
    }

    // -------------------------------------------------------------
    // ADMIN STATE PROCESSING
    // -------------------------------------------------------------
    if (isAdm && cache.adminStates.has(fromId)) {
        const aState = cache.adminStates.get(fromId);

        if (aState.action === 'cfg_join_bot') {
            cache.adminStates.delete(fromId);
            setSetting('join_bot_url', text);
            await sendMsg(chatId, `✅ জয়েন বট লিংক আপডেট হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_support') {
            cache.adminStates.delete(fromId);
            setSetting('support_url', text);
            await sendMsg(chatId, `✅ সাপোর্ট লিংক আপডেট হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_pay_channel') {
            const check = await verifyChannelAndBotAdmin(text);
            if (!check.ok) {
                await sendMsg(chatId, check.error, getCancelKeyboard());
                return;
            }
            cache.adminStates.delete(fromId);
            setSetting('withdraw_request_channel', check.channel_id);
            await sendMsg(chatId, `✅ Payment Channel Updated: <b>${escapeHtml(check.channel_title)}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'fc_add') {
            const check = await verifyChannelAndBotAdmin(text);
            if (!check.ok) {
                await sendMsg(chatId, check.error, getCancelKeyboard());
                return;
            }
            cache.adminStates.set(fromId, { action: 'fc_add_title', channel_id: check.channel_id, channel_link: check.channel_link, channel_title: check.channel_title });
            await sendMsg(chatId, `✅ চ্যানেল ভেরিফাইড: <b>${escapeHtml(check.channel_title)}</b>\n\nবাটনে কী নাম দেখাতে চান? লিখে পাঠান (যেমন: Join Channel):`, getCancelKeyboard());
            return;
        }
        if (aState.action === 'fc_add_title') {
            const btnTitle = text || aState.channel_title;
            const newKey = `fc_${Date.now()}`;
            const chObj = { channel_id: aState.channel_id, channel_link: aState.channel_link, channel_name: btnTitle };
            cache.forceChannels[newKey] = chObj;
            await db(`force_channels/${newKey}`, 'PUT', chObj);
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `🎉 <b>Force Join Channel Added:</b> ${escapeHtml(btnTitle)}`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_coin') {
            cache.adminStates.delete(fromId);
            setSetting('coin_name', text.toUpperCase());
            await sendMsg(chatId, `✅ Coin নাম পরিবর্তিত হয়েছে: <b>${escapeHtml(text.toUpperCase())}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_withdraw') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                cache.adminStates.delete(fromId);
                setSetting('min_withdraw', val);
                await sendMsg(chatId, `✅ ফিক্সড উইথড্র সেট হয়েছে: <b>${val}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
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
                await sendMsg(chatId, `✅ রেফার বোনাস সেট হয়েছে: <b>${val}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_welcome') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0) {
                cache.adminStates.delete(fromId);
                setSetting('welcome_bonus', val);
                await sendMsg(chatId, `✅ Welcome Bonus সেট হয়েছে: <b>${val}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_fee') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0 && val <= 100) {
                cache.adminStates.delete(fromId);
                setSetting('withdraw_fee_percent', val);
                await sendMsg(chatId, `✅ উইথড্র ফি আপডেট হয়েছে: <b>${val}%</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(chatId, '❌ 0 থেকে 100 এর মধ্যে সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_first_refs') {
            if (/^\d+$/.test(text)) {
                cache.adminStates.delete(fromId);
                setSetting('first_withdraw_refs', parseInt(text));
                await sendMsg(chatId, `✅ প্রথম উইথড্রতে রেফার প্রয়োজন: <b>${text}</b> টি`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(chatId, '❌ সঠিক পূর্ণসংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'pm_add') {
            cache.adminStates.delete(fromId);
            const newMethod = text.trim();
            let methods = cache.paymentMethods || [];
            if (!methods.includes(newMethod)) {
                methods.push(newMethod);
                cache.paymentMethods = methods;
                await db('settings/payment_methods', 'PUT', methods);
                await sendMsg(chatId, `✅ <b>${escapeHtml(newMethod)}</b> মেথড যুক্ত হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(chatId, `⚠️ এই মেথডটি ইতিমধ্যে আছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            }
            return;
        }
        if (aState.action === 'bal_add_user') {
            const target = await getUser(text);
            if (!target) {
                await sendMsg(chatId, "❌ ইউজার পাওয়া যায়নি!", getCancelKeyboard());
                return;
            }
            cache.adminStates.set(fromId, { action: 'bal_add_amount', target_id: text });
            await sendMsg(chatId, `👤 <b>${escapeHtml(target.first_name)}</b>\n💰 ব্যালেন্স: ${target.balance || 0}\nকত যোগ করতে চান?`, getCancelKeyboard());
            return;
        }
        if (aState.action === 'bal_add_amount') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                const targetU = await getUser(aState.target_id);
                const newBal = Number(targetU?.balance || 0) + val;
                updateUser(aState.target_id, { balance: newBal });
                cache.adminStates.delete(fromId);
                await sendMsg(chatId, `✅ <b>Added +${val}</b>\nNew Balance: <b>${newBal}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
                sendMsg(aState.target_id, `🎁 <b>+${val} ${getSetting('coin_name', 'STAR')} ব্যালেন্সে যোগ করা হয়েছে!</b>`);
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা দিন:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'bal_cut_user') {
            const target = await getUser(text);
            if (!target) {
                await sendMsg(chatId, "❌ ইউজার পাওয়া যায়নি!", getCancelKeyboard());
                return;
            }
            cache.adminStates.set(fromId, { action: 'bal_cut_amount', target_id: text });
            await sendMsg(chatId, `👤 <b>${escapeHtml(target.first_name)}</b>\n💰 ব্যালেন্স: ${target.balance || 0}\nকত কাটতে চান?`, getCancelKeyboard());
            return;
        }
        if (aState.action === 'bal_cut_amount') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                const targetU = await getUser(aState.target_id);
                const newBal = Math.max(0, Number(targetU?.balance || 0) - val);
                updateUser(aState.target_id, { balance: newBal });
                cache.adminStates.delete(fromId);
                await sendMsg(chatId, `✅ <b>Deducted -${val}</b>\nNew Balance: <b>${newBal}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
                sendMsg(aState.target_id, `⚠️ <b>-${val} ${getSetting('coin_name', 'STAR')} ব্যালেন্স থেকে কাটা হয়েছে!</b>`);
            } else {
                await sendMsg(chatId, '❌ সঠিক সংখ্যা দিন:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'sec_add_bl') {
            cache.blacklist[text] = { added_at: Math.floor(Date.now() / 1000) };
            await db(`security/blacklist/${text}`, 'PUT', cache.blacklist[text]);
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `🚫 ইউজার ${text} ব্ল্যাকলিস্টে যুক্ত হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'sec_rem_bl') {
            delete cache.blacklist[text];
            await db(`security/blacklist/${text}`, 'DELETE');
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `✅ ইউজার ${text} ব্ল্যাকলিস্ট থেকে রিমুভ হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'sec_add_wl') {
            cache.whitelist[text] = { added_at: Math.floor(Date.now() / 1000) };
            await db(`security/whitelist/${text}`, 'PUT', cache.whitelist[text]);
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `✅ ইউজার ${text} হোয়াইটলিস্টে যুক্ত হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'sec_rem_wl') {
            delete cache.whitelist[text];
            await db(`security/whitelist/${text}`, 'DELETE');
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `❌ ইউজার ${text} হোয়াইটলিস্ট থেকে রিমুভ হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'adm_add' && isSuper) {
            cache.admins[text] = { active: true, added_at: Math.floor(Date.now() / 1000) };
            await db(`admins/${text}`, 'PUT', cache.admins[text]);
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `🎉 Admin ${text} Added!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, true));
            return;
        }
        if (aState.action === 'adm_rem' && isSuper) {
            delete cache.admins[text];
            await db(`admins/${text}`, 'DELETE');
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, `✅ Admin ${text} Removed!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, true));
            return;
        }
        if (aState.action === 'set_payouts_done') {
            cache.adminStates.delete(fromId);
            setSetting('custom_payouts_done', text);
            await sendMsg(chatId, `✅ <b>Payouts Done সেট হয়েছে:</b> <b>${escapeHtml(text)}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'awaiting_users_bc') {
            cache.adminStates.delete(fromId);
            await sendMsg(chatId, "🚀 <b>ইউজার ব্রডকাস্ট শুরু হচ্ছে...</b>");
            const allUsers = await db('users') || {};
            let sCount = 0;
            for (const uid of Object.keys(allUsers)) {
                try {
                    const r = await copyMsg(uid, chatId, msg.message_id);
                    if (r?.ok) sCount++;
                } catch {}
            }
            await sendMsg(chatId, `✅ ব্রডকাস্ট সম্পন্ন! মোট পাঠানো হয়েছে: <b>${sCount}</b> জনকে।`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'awaiting_channel_bc') {
            cache.adminStates.delete(fromId);
            const channels = Object.values(cache.forceChannels || {}).filter(c => c && c.channel_id);
            let sCount = 0;
            for (const ch of channels) {
                try {
                    const r = await copyMsg(ch.channel_id, chatId, msg.message_id);
                    if (r?.ok) sCount++;
                } catch {}
            }
            await sendMsg(chatId, `📢 চ্যানেল ব্রডকাস্ট সম্পন্ন! সফল: <b>${sCount}</b> টি চ্যানেল।`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'set_source_info') {
            cache.adminStates.delete(fromId);
            const parts = text.split('|').map(s => s.trim());
            setSetting('custom_source_name', parts[0] || 'SΛKIB 〆 DΞVΞLOPΞR');
            setSetting('custom_source_link', parts[1] || `https://t.me/${BOT_USERNAME}`);
            await sendMsg(chatId, `✅ <b>কাস্টম সোর্স সফলভাবে আপডেট করা হয়েছে!</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
    }

    // -------------------------------------------------------------
    // USER STATE PROCESSING (Withdraw Address)
    // -------------------------------------------------------------
    if (!isAdm && cache.userStates.has(fromId)) {
        const uState = cache.userStates.get(fromId);
        if (uState.action === 'withdraw_address') {
            cache.userStates.delete(fromId);
            const fixedAmt = Number(getSetting('min_withdraw', 2));
            const coin = getSetting('coin_name', 'STAR');
            const curBal = Number(u.balance || 0);

            if (curBal < fixedAmt) {
                await sendMsg(chatId, `⚠️ অপর্যাপ্ত ব্যালেন্স! প্রয়োজন: <b>${fixedAmt} ${coin}</b>`, getUserMenu(false));
                return;
            }

            const fee = Number(getSetting('withdraw_fee_percent', 0));
            const afterFee = Math.max(0, fixedAmt - (fixedAmt * fee / 100));
            const txId = `${fromId}${Math.floor(Date.now() / 1000)}`;

            const wData = {
                user_id: fromId,
                first_name: msg.from.first_name || 'User',
                amount: fixedAmt,
                fee_percent: fee,
                after_fee: afterFee,
                method: uState.method || 'General',
                withdraw_address: text,
                transaction_id: txId,
                status: 'pending',
                created_at: Math.floor(Date.now() / 1000)
            };

            updateUser(fromId, { balance: curBal - fixedAmt });
            const saved = await db('withdrawals', 'POST', wData);

            await sendMsg(chatId, 
                `🔔 <b>Withdrawal Submitted!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `💳 Method: <b>${escapeHtml(uState.method || 'General')}</b>\n` +
                `💰 Amount: <b>${fixedAmt} ${coin}</b>\n` +
                `💵 After Fee: <b>${afterFee} ${coin}</b>\n` +
                `📬 Address: <code>${escapeHtml(text)}</code>\n` +
                `🧾 ID: <code>${txId}</code>\n` +
                `📌 Status: <b>PENDING ⏳</b>`, 
                getUserMenu(false)
            );

            // Alert to Payment Channel or Super Admin
            const alertCh = getSetting('withdraw_request_channel', SUPER_ADMIN_ID);
            if (saved?.name) {
                await sendMsg(alertCh, 
                    `🔔 <b>New Withdrawal Request!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 User: <b>${escapeHtml(msg.from.first_name)}</b> (<code>${fromId}</code>)\n` +
                    `💳 Method: <b>${escapeHtml(uState.method || 'General')}</b>\n` +
                    `💰 Amount: <b>${fixedAmt} ${coin}</b> (After Fee: <b>${afterFee} ${coin}</b>)\n` +
                    `📬 Send To: <code>${escapeHtml(text)}</code>\n` +
                    `🧾 TrxID: <code>${txId}</code>`, 
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

    // -------------------------------------------------------------
    // USER COMMANDS
    // -------------------------------------------------------------
    if (cmd === 'start') {
        const welcomeBonus = Number(getSetting('welcome_bonus', 0));
        if (!u.welcome_claimed && welcomeBonus > 0) {
            updateUser(fromId, { balance: Number(u.balance || 0) + welcomeBonus, welcome_claimed: true });
        }
        await sendMsg(chatId, `🌟 <b>Welcome, ${escapeHtml(msg.from.first_name)}!</b>\n\nEarn rewards easily and withdraw directly.`, getUserMenu(isAdm));
        return;
    }

    if (cmd === 'account') {
        const coin = getSetting('coin_name', 'STAR');
        const supportUrl = getSetting('support_url', 'https://t.me/AuraSupportsBot');
        await sendMsg(chatId, 
            `👤 <b>MY ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 Name: <b>${escapeHtml(msg.from.first_name)}</b>\n` +
            `🆔 ID: <code>${fromId}</code>\n` +
            `⭐ Balance: <b>${formatNumber(u.balance || 0)} ${coin}</b>\n` +
            `👥 Referrals: <b>${u.total_referrals || 0}</b>`, 
            {
                inline_keyboard: [[{ text: '🎧 Support', url: supportUrl }]]
            }
        );
        return;
    }

    if (cmd === 'referral') {
        const coin = getSetting('coin_name', 'STAR');
        const refBonus = getSetting('referral_bonus', 1);
        const refLink = `https://t.me/${BOT_USERNAME}?start=${fromId}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(`🌟 Join @${BOT_USERNAME} and earn free ${coin}!`)}`;

        await sendMsg(chatId, 
            `📮 <b>Referral Program</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👥 Total Referrals: <b>${u.total_referrals || 0}</b>\n` +
            `💰 Per Referral: <b>${refBonus} ${coin}</b>\n\n` +
            `🔗 <b>Your Invite Link:</b>\n<code>${refLink}</code>\n\n` +
            `<i>⚠️ Note: Referrals count only after channels are verified!</i>`, 
            {
                inline_keyboard: [[{ text: '🚀 Share Link', url: shareUrl }]]
            }
        );
        return;
    }

    if (cmd === 'withdraw') {
        const coin = getSetting('coin_name', 'STAR');
        const fixedAmt = Number(getSetting('min_withdraw', 2));
        const curBal = Number(u.balance || 0);

        if (curBal < fixedAmt) {
            await sendMsg(chatId, `⚠️ <b>অপর্যাপ্ত ব্যালেন্স!</b>\n\nমিনিমাম উইথড্র: <b>${fixedAmt} ${coin}</b>\nআপনার ব্যালেন্স: <b>${formatNumber(curBal)} ${coin}</b>`);
            return;
        }

        const reqRefs = Number(getSetting('first_withdraw_refs', 0));
        const userRefs = Number(u.total_referrals || 0);
        if (!u.has_withdrawn && reqRefs > 0 && userRefs < reqRefs) {
            await sendMsg(chatId, `⚠️ <b>প্রথম উইথড্র করার জন্য আপনার কমপক্ষে ${reqRefs} টি রেফার প্রয়োজন!</b>\n\nআপনার বর্তমান রেফার: <b>${userRefs}/${reqRefs}</b>`);
            return;
        }

        const methods = cache.paymentMethods || ['bKash', 'Nagad', 'Rocket'];
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

    if (cmd === 'history') {
        const coin = getSetting('coin_name', 'STAR');
        const allW = await db('withdrawals') || {};
        const myW = Object.values(allW).filter(w => String(w.user_id) === fromId);
        if (!myW.length) {
            await sendMsg(chatId, '📜 কোনো উইথড্র রেকর্ড পাওয়া যায়নি।');
            return;
        }
        let out = `📜 <b>YOUR WITHDRAWAL HISTORY:</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const item of myW.slice(-5).reverse()) {
            out += `• <b>${item.status.toUpperCase()}</b> | ${item.amount} ${coin} (${item.method || 'General'})\n  🕒 ${formatTimestamp(item.created_at)}\n`;
        }
        await sendMsg(chatId, out);
        return;
    }

    // SYSTEM STATUS
    if (cmd === 'status') {
        const users = await db('users') || {};
        const totalCount = Object.keys(users).length;
        const payouts = getSetting('custom_payouts_done', '15');
        const coin = getSetting('coin_name', 'STAR');
        const sName = getSetting('custom_source_name', 'SΛKIB 〆 DΞVΞLOPΞR');
        const sLink = getSetting('custom_source_link', `https://t.me/${BOT_USERNAME}`);

        const stText = 
            `📡 <b>SYSTEM STATUS</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `👥 <b>Total Users:</b> ${totalCount} Users\n\n` +
            `⭐ <b>Payouts Done:</b> ${escapeHtml(payouts)} ${escapeHtml(coin)}\n\n` +
            `🔧 <b>Source:</b> <a href="${escapeHtml(sLink)}">${escapeHtml(sName)}</a>`;

        await sendMsg(chatId, stText);
        return;
    }

    // -------------------------------------------------------------
    // ADMIN PANEL COMMANDS
    // -------------------------------------------------------------
    if (isAdm) {
        if (cmd === 'admin_panel') {
            await sendMsg(chatId, '🛠 <b>Admin Panel Activated</b>', getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (cmd === 'back_user') {
            await sendMsg(chatId, '👤 <b>User Panel Activated</b>', getUserMenu(true));
            return;
        }
        if (cmd === 'bot_power') {
            const newStatus = cache.botActive ? 'off' : 'on';
            setSetting('bot_power_status', newStatus);
            await sendMsg(chatId, `🔄 Bot Status: <b>${newStatus === 'on' ? '🟢 ONLINE' : '🔴 OFFLINE'}</b>`, getFullAdminMenu(newStatus === 'on', cache.whitelistOnly, isSuper));
            return;
        }
        if (cmd === 'central_settings') {
            await sendMsg(chatId, '⚙️ <b>Central Configuration:</b>', centralSettingsKeyboard());
            return;
        }
        if (cmd === 'user_balance') {
            await sendMsg(chatId, '👥 <b>User & Balance Management:</b>', {
                inline_keyboard: [
                    [{ text: '➕ ব্যালেন্স যোগ করুন', callback_data: 'bal_add' }, { text: '➖ ব্যালেন্স কাটুন', callback_data: 'bal_cut' }]
                ]
            });
            return;
        }
        if (cmd === 'channel_broadcast') {
            cache.adminStates.set(fromId, { action: 'awaiting_channel_bc' });
            await sendMsg(chatId, "📢 <b>সকল ফোর্স চ্যানেলে ব্রডকাস্ট করার মেসেজটি পাঠান:</b>", getCancelKeyboard());
            return;
        }
        if (cmd === 'users_broadcast') {
            cache.adminStates.set(fromId, { action: 'awaiting_users_bc' });
            await sendMsg(chatId, "📢 <b>সকল ইউজারের কাছে ব্রডকাস্ট করার মেসেজটি পাঠান:</b>", getCancelKeyboard());
            return;
        }
        if (cmd === 'security') {
            await sendMsg(chatId, "🛡️ <b>Security Management</b>\nব্লকলিস্ট ও হোয়াইটলিস্ট কন্ট্রোল:", securityKeyboard(cache.whitelistOnly));
            return;
        }
        if (cmd === 'force_channels') {
            const count = Object.keys(cache.forceChannels || {}).length;
            await sendMsg(chatId, `📢 <b>FORCE JOIN CHANNELS</b>\nমোট চ্যানেল: <b>${count}</b> টি`, {
                inline_keyboard: [
                    [{ text: '➕ চ্যানেল যোগ করুন', callback_data: 'fc_add' }, { text: '➖ চ্যানেল রিমুভ করুন', callback_data: 'fc_remove' }],
                    [{ text: '📋 চ্যানেল তালিকা', callback_data: 'fc_list' }]
                ]
            });
            return;
        }
        if (cmd === 'payment_methods') {
            const methods = cache.paymentMethods || [];
            let mList = methods.map((m, i) => `${i + 1}. <b>${escapeHtml(m)}</b>`).join('\n');
            await sendMsg(chatId, 
                `💳 <b>PAYMENT METHODS MANAGEMENT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                `বর্তমান সক্রিয় মেথড:\n${mList || 'কোনো মেথড নেই'}\n\n` +
                `নিচের বাটন দিয়ে পরিচালনা করুন:`,
                {
                    inline_keyboard: [
                        [{ text: '➕ Add Method', callback_data: 'pm_add' }, { text: '➖ Remove Method', callback_data: 'pm_remove' }]
                    ]
                }
            );
            return;
        }
        if (cmd === 'payouts_done') {
            cache.adminStates.set(fromId, { action: 'set_payouts_done' });
            const cur = getSetting('custom_payouts_done', '15');
            await sendMsg(chatId, `⭐ <b>Payouts Done</b>\nবর্তমান মান: <b>${escapeHtml(cur)}</b>\nনতুন সংখ্যা পাঠান:`, getCancelKeyboard());
            return;
        }
        if (cmd === 'source_settings') {
            cache.adminStates.set(fromId, { action: 'set_source_info' });
            await sendMsg(chatId, '🔧 <b>সোর্স সেটিংস:</b>\nফরম্যাট: <code>নাম | লিংক</code>\n\nউদাহরণ: <code>SΛKIB 〆 DΞVΞLOPΞR | https://t.me/username</code>', getCancelKeyboard());
            return;
        }
        if (cmd === 'admin_management' && isSuper) {
            await sendMsg(chatId, "👮 <b>এডমিন ম্যানেজমেন্ট</b>", {
                inline_keyboard: [
                    [{ text: '➕ এডমিন যোগ করুন', callback_data: 'adm_add' }, { text: '➖ এডমিন রিমুভ করুন', callback_data: 'adm_rem' }],
                    [{ text: '👮 এডমিন তালিকা', callback_data: 'adm_list' }]
                ]
            });
            return;
        }
    }

    // Default Fallback
    await sendMsg(chatId, `🌟 <b>Welcome ${escapeHtml(msg.from.first_name)}!</b>\nEarn rewards easily and withdraw directly.`, getUserMenu(isAdm));
}

/*
|--------------------------------------------------------------------------
| 6. SERVER & INITIALIZATION
|--------------------------------------------------------------------------
*/
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        await handleUpdate(req.body);
    } catch (e) {
        console.error('Update Handler Error:', e);
    }
});

app.get('/ping', (req, res) => res.send('Pong 🏓'));
app.get('/', (req, res) => res.send(`Bot @${BOT_USERNAME || 'Active'} is Running Live 🚀`));

setInterval(() => {
    fetch(`${APP_URL}/ping`).catch(() => {});
}, 8 * 60 * 1000);

async function initSystem() {
    console.log('⚡ Initializing Bot Engine...');
    const me = await telegramApi('getMe');
    if (me?.ok) {
        BOT_USERNAME = me.result.username;
        BOT_ID = String(me.result.id);
        console.log(`🤖 Bot Logged In: @${BOT_USERNAME} (${BOT_ID})`);
    } else {
        console.error('❌ Failed to fetch bot info. Check BOT_TOKEN!');
    }

    // Default System Settings in Firebase
    const existing = await db('settings');
    if (!existing) {
        await db('settings', 'PUT', {
            coin_name: 'STAR',
            min_withdraw: 2,
            referral_bonus: 1,
            welcome_bonus: 0,
            withdraw_fee_percent: 0,
            first_withdraw_refs: 0,
            bot_power_status: 'on',
            whitelist_only_mode: 'off',
            custom_payouts_done: '15',
            custom_source_name: 'SΛKIB 〆 DΞVΞLOPΞR',
            payment_methods: ['bKash', 'Nagad', 'Rocket']
        });
    }

    // Register Webhook
    const webhookUrl = `${APP_URL}/webhook`;
    const whRes = await telegramApi('setWebhook', { url: webhookUrl, drop_pending_updates: true });
    console.log('🔗 Webhook Setup Result:', whRes);
}

const PORT = process.env.PORT || 8000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initSystem();
});
