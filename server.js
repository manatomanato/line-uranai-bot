require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const paidUsersFile = 'paidUsers.json';

// 📌 ルートエンドポイント (/) （Render動作確認用）
app.get("/", (req, res) => {
    res.send("🚀 LINE占いBotが正常に動作しています！");
});

// 📌 STORESの決済ページURL（固定）
const PAYMENT_LINK = "https://manabuyts.stores.jp/items/12345678";

// 📌 有料ユーザー管理（JSONファイルを使用）
function getPaidUsers() {
    if (!fs.existsSync(paidUsersFile)) {
        fs.writeFileSync(paidUsersFile, JSON.stringify({})); // 🚀 初期化
    }
    try {
        return JSON.parse(fs.readFileSync(paidUsersFile, 'utf8'));
    } catch (error) {
        console.error('JSONファイルの読み込みエラー:', error);
        return {};
    }
}

function addPaidUser(userId) {
    const paidUsers = getPaidUsers();
    paidUsers[userId] = true;
    fs.writeFileSync(paidUsersFile, JSON.stringify(paidUsers, null, 2));
}

async function checkSubscription(userId) {
    const paidUsers = getPaidUsers();
    return !!paidUsers[userId];
}

// 📌 決済リンク取得API（LINE以外で使う場合用）
app.post('/get-payment-link', async (req, res) => {
    res.json({ url: PAYMENT_LINK });
});

// 📌 Webhook（決済通知 & LINEメッセージ処理）
app.post('/webhook', async (req, res) => {
    console.log('Webhook received:', req.body);

    // 📌 決済通知（PAY.JPなどの決済サービス用）
    const userIdFromPayment = req.body?.data?.object?.metadata?.userId;
    if (userIdFromPayment) {
        console.log(`決済成功: ${userIdFromPayment}`);
        addPaidUser(userIdFromPayment);
        return res.status(200).send('User updated');
    }

    // 📌 LINEメッセージ処理
    const events = req.body.events;
    if (!events) {
        return res.status(400).send('Invalid request');
    }

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            console.log(`ユーザー(${userId})のメッセージ: ${userMessage}`);

            const isPaidUser = await checkSubscription(userId);

            if (!isPaidUser) {
                await replyMessage(userId, `このサービスは月額500円です。\n登録はこちら: ${PAYMENT_LINK}`);
                return;
            }

            const replyText = await getChatGPTResponse(userMessage);
            await replyMessage(userId, replyText);
        }
    }

    res.sendStatus(200);
});

// 📌 ChatGPT APIを使って占いのメッセージを取得
async function getChatGPTResponse(userMessage) {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4",
            messages: [
                { role: "system", content: "あなたは優しい占い師です。相談者の悩みに占いの視点から前向きなアドバイスをしてください。" },
                { role: "user", content: userMessage }
            ]
        }, {
            headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("ChatGPT APIエラー:", error);
        return "占いの結果を取得できませんでした…もう一度試してください。";
    }
}

// 📌 LINE APIでユーザーに返信
async function replyMessage(userId, text) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{ type: "text", text }]
        }, {
            headers: {
                "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
    } catch (error) {
        console.error(`LINEメッセージ送信エラー (${userId}):`, error);
    }
}

// 📌 サーバー起動（Render対応）
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
