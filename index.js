require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// Корректный импорт GigaChat (пробуем разные варианты)
let GigaChat;
try {
  GigaChat = require('gigachat').default;
} catch (e) {
  try {
    GigaChat = require('gigachat');
  } catch (e2) {
    console.error('Не удалось загрузить GigaChat. Установите пакет: npm install gigachat');
    process.exit(1);
  }
}
const { Agent } = require('node:https');

// Хранилище тем
const userTopics = new Map();

// Диагностика
console.log('=== DIAGNOSTICS ===');
console.log('BOT_TOKEN defined:', !!process.env.BOT_TOKEN);
console.log('BOT_TOKEN length:', process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 0);
console.log('CHANNEL_USERNAME defined:', !!process.env.CHANNEL_USERNAME);
console.log('WEBAPP_URL defined:', !!process.env.WEBAPP_URL);
console.log('SECRET_LINK defined:', !!process.env.SECRET_LINK);
console.log('GIGACHAT_CREDENTIALS defined:', !!process.env.GIGACHAT_CREDENTIALS);
console.log('====================');

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const webhookUrl = `${webAppUrl}/webhook`;
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook установлен на ${webhookUrl}`);
}).catch(err => {
  console.error('Ошибка установки вебхука:', err);
});

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Привет! Чтобы получить доступ, нажмите кнопку ниже для проверки подписки.', {
    reply_markup: {
      inline_keyboard: [[{ text: '🔎 Проверить подписку', web_app: { url: webAppUrl } }]]
    }
  });
});

async function sendMainMenu(chatId) {
  const menuMessage = `
✨ *Добро пожаловать в «Настройщик души»* ✨

Выберите тему:

🌿 *Безопасность* — тревога
💗 *Принятие* — одиночество
🧩 *Понимание себя* — «кто я?»
🌟 *Смысл* — потерян ориентир
🕊️ *Свобода* — «в клетке»
  `;
  const keyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '🌿 Безопасность' }],
        [{ text: '💗 Принятие' }],
        [{ text: '🧩 Понимание себя' }],
        [{ text: '🌟 Смысл' }],
        [{ text: '🕊️ Свобода' }]
      ],
      resize_keyboard: true
    }
  };
  await bot.sendMessage(chatId, menuMessage, { parse_mode: 'Markdown', ...keyboard });
}

async function getGigaChatResponse(userMessage, level) {
  const httpsAgent = new Agent({ rejectUnauthorized: false });
  if (!process.env.GIGACHAT_CREDENTIALS) {
    console.error('GIGACHAT_CREDENTIALS не заданы');
    return 'Извините, нейросеть временно недоступна.';
  }
  const client = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    scope: 'GIGACHAT_API_PERS',
    model: 'GigaChat',
    httpsAgent: httpsAgent,
    timeout: 60
  });
  const systemPrompt = getSystemPrompt(level);
  try {
    console.log(`[GigaChat] Запрос, тема: ${level}, сообщение: "${userMessage.substring(0,50)}..."`);
    const response = await client.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    const answer = response.choices[0]?.message.content || 'Нет ответа';
    console.log(`[GigaChat] Ответ получен, длина: ${answer.length}`);
    return answer;
  } catch (error) {
    console.error('[GigaChat] Ошибка:', error.message);
    return 'Извините, сейчас не могу ответить. Попробуйте позже.';
  }
}

function getSystemPrompt(level) {
  const prompts = {
    'Безопасность': 'Ты — психологический помощник. Тема "Безопасность" (тревога, страх). Помоги через технику принятия, задавай вопросы, предлагай упражнения. Будь мягким.',
    'Принятие': 'Ты — психологический помощник. Тема "Принятие" (одиночество, любовь). Исследуй чувства, помогай признать их.',
    'Понимание себя': 'Ты — психологический помощник. Тема "Понимание себя" (самооценка, внутренний диалог). Помоги услышать разные части себя.',
    'Смысл': 'Ты — психологический помощник. Тема "Смысл" (потеря ориентира). Не давай готовых ответов, помогай искать внутри.',
    'Свобода': 'Ты — психологический помощник. Тема "Свобода" (ощущение ограничений). Исследуй, что создаёт чувство клетки, предлагай маленькие шаги.'
  };
  return prompts[level] || prompts['Понимание себя'];
}

bot.on('message', async (msg) => {
  console.log('=== ВХОДЯЩЕЕ СООБЩЕНИЕ ===');
  console.log('Chat ID:', msg.chat.id);
  console.log('Текст:', msg.text);
  const currentTopic = userTopics.get(msg.chat.id);
  console.log('Текущая тема:', currentTopic);

  const chatId = msg.chat.id;
  const text = msg.text;
  if (text.startsWith('/')) {
    console.log('Игнорируем команду');
    return;
  }

  const levelMap = {
    '🌿 Безопасность': 'Безопасность',
    '💗 Принятие': 'Принятие',
    '🧩 Понимание себя': 'Понимание себя',
    '🌟 Смысл': 'Смысл',
    '🕊️ Свобода': 'Свобода'
  };

  if (levelMap[text]) {
    const level = levelMap[text];
    userTopics.set(chatId, level);
    console.log(`Установлена тема для ${chatId}: ${level}`);
    await bot.sendChatAction(chatId, 'typing');
    const initialPrompt = `Я выбрал тему "${level}". Поговори со мной об этом.`;
    const response = await getGigaChatResponse(initialPrompt, level);
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    console.log('Ответ на приветствие отправлен');
    return;
  }

  const currentLevel = userTopics.get(chatId);
  if (!currentLevel) {
    console.log('Нет активной темы, сообщение проигнорировано');
    return;
  }

  console.log(`Есть активная тема: ${currentLevel}, отправляем в GigaChat`);
  await bot.sendChatAction(chatId, 'typing');
  const response = await getGigaChatResponse(text, currentLevel);
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  console.log('Ответ отправлен');
});

const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const BOT_TOKEN = process.env.BOT_TOKEN;
app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_USERNAME}&user_id=${userId}`;
    const tgRes = await axios.get(url);
    const status = tgRes.data.result.status;
    const isMember = ['member', 'administrator', 'creator'].includes(status);
    if (isMember) await sendMainMenu(userId);
    res.json({ ok: true, isMember });
  } catch (e) {
    console.error('Ошибка проверки:', e.message);
    res.status(500).json({ ok: false, error: 'Ошибка проверки' });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL: ${webAppUrl}/webhook`);
});
