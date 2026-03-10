require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const GigaChat = require('gigachat');
const { Agent } = require('node:https');

// --- Диагностика ---
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

// --- Создаём бота без polling (только для отправки сообщений) ---
const bot = new TelegramBot(token);

// --- Express сервер (будет принимать вебхуки) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === Установка вебхука при запуске ===
const webhookUrl = `${webAppUrl}/webhook`; // путь для вебхука
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook установлен на ${webhookUrl}`);
}).catch(err => {
  console.error('Ошибка установки вебхука:', err);
});

// --- Обработчик вебхука (Telegram будет присылать сюда обновления) ---
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- Обработка команды /start ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 Привет! Чтобы получить доступ, нажмите кнопку ниже для проверки подписки.', {
    reply_markup: {
      inline_keyboard: [
        [{
          text: '🔎 Проверить подписку',
          web_app: { url: webAppUrl }
        }]
      ]
    }
  });
});

// --- Функция отправки главного меню ---
async function sendMainMenu(chatId) {
  const menuMessage = `
✨ *Добро пожаловать в «Настройщик души»* ✨

Выберите тему, с которой хотите поработать:

🌿 *Безопасность* — когда тревожно и неспокойно
💗 *Принятие* — когда чувствуете одиночество
🧩 *Понимание себя* — когда «не знаю, кто я»
🌟 *Смысл* — когда потерян ориентир
🕊️ *Свобода* — когда «в клетке»
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
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };

  await bot.sendMessage(chatId, menuMessage, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// --- GigaChat функции ---
async function getGigaChatResponse(userMessage, level) {
  const httpsAgent = new Agent({ rejectUnauthorized: false });
  const client = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    scope: 'GIGACHAT_API_PERS',
    model: 'GigaChat',
    httpsAgent: httpsAgent,
    timeout: 60
  });

  const systemPrompt = getSystemPrompt(level);

  try {
    const response = await client.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    return response.choices[0]?.message.content || 'Не удалось сгенерировать ответ.';
  } catch (error) {
    console.error('GigaChat error:', error);
    return 'Извините, сейчас я не могу ответить. Попробуйте позже.';
  }
}

function getSystemPrompt(level) {
  const prompts = {
    'Безопасность': 'Ты — психологический помощник. Пользователь выбрал тему "Безопасность" (тревога, страх). Помоги ему через технику принятия, задавай вопросы, предлагай простые упражнения. Будь мягким и поддерживающим.',
    'Принятие': 'Ты — психологический помощник. Тема: "Принятие" (одиночество, потребность в любви). Исследуй чувства пользователя, помогай признать их, предлагай упражнения на самоподдержку.',
    'Понимание себя': 'Ты — психологический помощник. Тема: "Понимание себя" (самооценка, внутренний диалог). Помоги пользователю услышать разные части себя, задавай вопросы о его ценностях.',
    'Смысл': 'Ты — психологический помощник. Тема: "Смысл" (потеря ориентира). Не давай готовых ответов, помогай искать внутри себя, спрашивай о том, что раньше приносило радость.',
    'Свобода': 'Ты — психологический помощник. Тема: "Свобода" (ощущение ограничений). Исследуй, что именно создаёт чувство клетки, помогай признать это, предлагай маленькие шаги для расширения пространства выбора.'
  };
  return prompts[level] || prompts['Понимание себя'];
}

// --- Обработчик нажатий на кнопки меню ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) return;

  const levelMap = {
    '🌿 Безопасность': 'Безопасность',
    '💗 Принятие': 'Принятие',
    '🧩 Понимание себя': 'Понимание себя',
    '🌟 Смысл': 'Смысл',
    '🕊️ Свобода': 'Свобода'
  };

  const level = levelMap[text];
  if (!level) return;

  await bot.sendChatAction(chatId, 'typing');
  const initialPrompt = `Я выбрал тему "${level}". Поговори со мной об этом.`;
  const response = await getGigaChatResponse(initialPrompt, level);
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// --- Эндпоинт проверки подписки (из WebApp) ---
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const BOT_TOKEN = process.env.BOT_TOKEN;

app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ ok: false, error: 'userId required' });
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_USERNAME}&user_id=${userId}`;
    const tgRes = await axios.get(url);
    const status = tgRes.data.result.status;
    const isMember = ['member', 'administrator', 'creator'].includes(status);

    if (isMember) {
      await sendMainMenu(userId);
    }

    res.json({ ok: true, isMember });

  } catch (e) {
    console.error(`Error checking subscription for userId=${userId}:`, e.response ? e.response.data : e.message);
    res.status(500).json({ ok: false, error: 'Ошибка проверки на стороне сервера.' });
  }
});

// --- Запуск сервера ---
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL: ${webAppUrl}/webhook`);
});
