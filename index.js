require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// --- Глобальные обработчики ошибок ---
process.on('uncaughtException', (err) => {
  console.error('🔥 НЕПЕРЕХВАЧЕННОЕ ИСКЛЮЧЕНИЕ:', err);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 НЕОБРАБОТАННЫЙ ОТКАЗ PROMISE:', reason);
  if (reason && reason.stack) console.error(reason.stack);
});

// --- Импорт GigaChat ---
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

// --- Хранилище последней темы ---
const userTopics = new Map();

// --- Чтение переменных окружения ---
const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

// Канал 1 (всегда обязательный)
const CHANNEL1_ID = process.env.CHANNEL1_ID;
const CHANNEL1_NAME = process.env.CHANNEL1_NAME || 'Основной канал';
const CHANNEL1_LINK = process.env.CHANNEL1_LINK;
const CHANNEL1_SHOW = process.env.CHANNEL1_SHOW !== 'false'; // по умолчанию true

// Канал 2 (настраиваемый)
const CHANNEL2_ID = process.env.CHANNEL2_ID;
const CHANNEL2_NAME = process.env.CHANNEL2_NAME || 'Дополнительный канал';
const CHANNEL2_LINK = process.env.CHANNEL2_LINK;
const CHANNEL2_SHOW = process.env.CHANNEL2_SHOW === 'true'; // по умолчанию false
const CHANNEL2_REQUIRED = process.env.CHANNEL2_REQUIRED === 'true'; // по умолчанию false

// --- Диагностика ---
console.log('=== DIAGNOSTICS ===');
console.log('BOT_TOKEN defined:', !!token);
console.log('BOT_TOKEN length:', token ? token.length : 0);
console.log('CHANNEL1_ID:', CHANNEL1_ID);
console.log('CHANNEL1_NAME:', CHANNEL1_NAME);
console.log('CHANNEL1_LINK:', CHANNEL1_LINK);
console.log('CHANNEL1_SHOW:', CHANNEL1_SHOW);
console.log('CHANNEL2_ID:', CHANNEL2_ID);
console.log('CHANNEL2_NAME:', CHANNEL2_NAME);
console.log('CHANNEL2_LINK:', CHANNEL2_LINK);
console.log('CHANNEL2_SHOW:', CHANNEL2_SHOW);
console.log('CHANNEL2_REQUIRED:', CHANNEL2_REQUIRED);
console.log('WEBAPP_URL defined:', !!webAppUrl);
console.log('GIGACHAT_CREDENTIALS defined:', !!process.env.GIGACHAT_CREDENTIALS);
console.log('====================');

const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Вебхук ---
const webhookUrl = `${webAppUrl}/webhook`;
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook установлен на ${webhookUrl}`);
}).catch(err => {
  console.error('Ошибка установки вебхука:', err);
});

app.post('/webhook', (req, res) => {
  console.log('📩 Получен POST запрос на /webhook');
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- Функции проверки подписки на один канал ---
async function checkSubscription(userId, channelId, channelName) {
  if (!channelId) {
    console.log(`⚠️ ${channelName} не задан, пропускаем проверку`);
    return { isMember: true, error: false };
  }
  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${channelId}&user_id=${userId}`;
    console.log(`🔍 Проверка подписки на ${channelName} (${channelId}) для userId ${userId}`);
    const res = await axios.get(url);
    const status = res.data.result.status;
    const isMember = ['member', 'administrator', 'creator'].includes(status);
    console.log(`📊 Результат проверки ${channelName}: статус ${status}, подписан: ${isMember}`);
    return { isMember, error: false };
  } catch (e) {
    console.error(`❌ Ошибка проверки подписки для канала ${channelName} (${channelId}):`, e.message);
    if (e.response) console.error('Детали ошибки:', e.response.data);
    return { isMember: false, error: true };
  }
}

// --- Получение статуса подписки для всех каналов (проверяем все, у которых есть ID) ---
async function getSubscriptionStatus(userId) {
  const statuses = [];

  // Канал 1 (всегда проверяем, если задан)
  if (CHANNEL1_ID) {
    const sub1 = await checkSubscription(userId, CHANNEL1_ID, CHANNEL1_NAME);
    statuses.push({
      id: CHANNEL1_ID,
      name: CHANNEL1_NAME,
      link: CHANNEL1_LINK,
      isMember: sub1.isMember,
      error: sub1.error,
      required: true, // канал 1 всегда обязательный
      show: CHANNEL1_SHOW
    });
  }

  // Канал 2 (проверяем всегда, если задан ID)
  if (CHANNEL2_ID) {
    const sub2 = await checkSubscription(userId, CHANNEL2_ID, CHANNEL2_NAME);
    statuses.push({
      id: CHANNEL2_ID,
      name: CHANNEL2_NAME,
      link: CHANNEL2_LINK,
      isMember: sub2.isMember,
      error: sub2.error,
      required: CHANNEL2_REQUIRED,
      show: CHANNEL2_SHOW
    });
  }

  console.log('📋 Полный статус подписки:', JSON.stringify(statuses, null, 2));
  return statuses;
}

// --- Проверка, подписан ли на все обязательные каналы ---
function isFullySubscribed(statuses) {
  return statuses.every(ch => !ch.required || ch.isMember);
}

// --- Формирование сообщения о неподписке с кнопками для каналов, у которых show=true и нет подписки ---
function formatUnsubscribedMessage(statuses) {
  const missing = statuses.filter(ch => ch.show && !ch.isMember);
  if (missing.length === 0) return null;

  let text = '❌ Для доступа необходимо подписаться на каналы:\n\n';
  const buttons = [];

  for (const ch of missing) {
    text += `• ${ch.name}\n`;
    if (ch.link) {
      buttons.push([{ text: `📢 Подписаться на ${ch.name}`, url: ch.link }]);
    } else {
      text += `  (ссылка не указана, обратитесь к администратору)\n`;
    }
  }

  text += '\nПосле подписки нажмите /start или отправьте любое сообщение, чтобы проверить снова.';
  return { text, buttons };
}

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

// --- Главное меню ---
async function sendMainMenu(chatId) {
  const menuMessage = `
✨ *Добро пожаловать в «Настройщик души»* ✨

Выберите тему, с которой хотите поработать:

🌿 *Безопасность* — тревога, страхи
💗 *Принятие* — одиночество, любовь
🧩 *Понимание себя* — самооценка, внутренний диалог
🌟 *Смысл* — потеря ориентира
🕊️ *Свобода* — ограничения, выбор
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

  await bot.sendMessage(chatId, menuMessage, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// --- Функция для GigaChat ---
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
      temperature: 0.8,
      max_tokens: 250
    });
    const answer = response.choices[0]?.message.content || 'Не удалось сгенерировать ответ.';
    console.log(`[GigaChat] Ответ получен, длина: ${answer.length}`);
    return answer;
  } catch (error) {
    console.error('[GigaChat] Ошибка:', error.message, error.stack);
    return '🚧 Извините, нейросеть временно не отвечает. Попробуйте чуть позже.';
  }
}

// --- Промпты (вопросный стиль) ---
function getSystemPrompt(level) {
  const prompts = {
    'Безопасность': `Ты — психолог, работающий в кратком, вопросном стиле. Тема: "Безопасность" (тревога, страх). Твоя задача — помочь человеку исследовать его чувства, задавая открытые вопросы. Не давай готовых советов, не оценивай, не читай мораль. Задавай вопросы, которые помогут человеку самому прийти к пониманию.

Примеры вопросов:
- "Что именно вызывает у тебя тревогу?"
- "Когда это чувство появляется?"
- "Как твоё тело реагирует на страх?"
- "Что ты обычно делаешь в такие моменты?"
- "Бывало ли такое раньше? Чем это заканчивалось?"

После ответа человека задавай следующий уточняющий вопрос. Не пиши длинных текстов. Будь мягким, но направляющим.`,

    'Принятие': `Ты — психолог, работающий в кратком, вопросном стиле. Тема: "Принятие" (одиночество, любовь). Помоги человеку исследовать его чувство одиночества или нехватки принятия. Задавай открытые вопросы, не давай советов.

Примеры вопросов:
- "В каких ситуациях ты чувствуешь себя одиноким?"
- "Как ты понимаешь, что тебя не принимают?"
- "Что для тебя значит 'быть принятым'?"
- "Есть ли люди, с которыми ты чувствуешь себя комфортно?"
- "Что бы ты хотел изменить в отношениях с близкими?"

Продолжай диалог, задавая вопросы по ответам.`,

    'Понимание себя': `Ты — психолог, работающий в кратком, вопросном стиле. Тема: "Понимание себя" (самооценка, внутренний диалог). Помоги человеку услышать разные части себя.

Примеры вопросов:
- "Какая часть тебя говорит это?"
- "А что хочет другая часть?"
- "Когда ты впервые заметил этот внутренний голос?"
- "Как бы ты описал свои сильные стороны?"
- "Что тебе мешает быть собой?"

Задавай вопросы, не давай готовых ответов.`,

    'Смысл': `Ты — психолог, работающий в кратком, вопросном стиле. Тема: "Смысл" (потеря ориентира). Помоги человеку искать смысл внутри себя.

Примеры вопросов:
- "Что приносило тебе радость раньше?"
- "За чем ты скучаешь?"
- "Что для тебя важно в жизни?"
- "Если бы у тебя была волшебная палочка, что бы ты изменил?"
- "Были ли моменты, когда ты чувствовал себя живым?"

Не давай ответов, только вопросы.`,

    'Свобода': `Ты — психолог, работающий в кратком, вопросном стиле. Тема: "Свобода" (ощущение ограничений). Помоги человеку исследовать, что именно его ограничивает.

Примеры вопросов:
- "В чём именно ты чувствуешь себя несвободным?"
- "Ты заложник ситуации или своих мыслей?"
- "Если бы можно было сделать всё что угодно, что бы ты выбрал?"
- "Кто ты в этой истории: жертва, спасатель или тиран?"
- "Что случится, если ты позволишь себе быть свободным?"

Задавай вопросы, помогай увидеть выходы.`
  };
  return prompts[level] || prompts['Понимание себя'];
}

// --- Основной обработчик сообщений ---
bot.on('message', async (msg) => {
  console.log('=== ВХОДЯЩЕЕ СООБЩЕНИЕ ===');
  console.log('Chat ID:', msg.chat.id);
  console.log('Текст:', msg.text);

  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) {
    console.log('Игнорируем команду');
    return;
  }

  // --- 1. Проверка подписки (всегда для всех каналов) ---
  console.log('🔐 Получаем статус подписки...');
  const statuses = await getSubscriptionStatus(chatId);
  const fullySubscribed = isFullySubscribed(statuses);
  console.log(`🔐 Полностью подписан на обязательные: ${fullySubscribed}`);

  // Всегда показываем недостающие каналы (у которых show=true)
  const unsubInfo = formatUnsubscribedMessage(statuses);
  if (unsubInfo) {
    console.log('❌ Пользователь не подписан на некоторые каналы (показываем)');
    await bot.sendMessage(chatId, unsubInfo.text, {
      reply_markup: { inline_keyboard: unsubInfo.buttons }
    });
    // Если не хватает подписки на обязательные, дальше не идём
    if (!fullySubscribed) return;
  }

  // Если подписка на обязательные есть, продолжаем диалог
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
    console.log(`✅ Установлена тема для пользователя ${chatId}: ${level}`);

    await bot.sendChatAction(chatId, 'typing');
    const initialPrompt = `Я выбрал тему "${level}". Поговори со мной об этом.`;
    const response = await getGigaChatResponse(initialPrompt, level);
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    return;
  }

  const currentLevel = userTopics.get(chatId);
  if (!currentLevel) {
    console.log('⛔ Нет активной темы, сообщение проигнорировано');
    return;
  }

  console.log(`➡️ Есть активная тема: ${currentLevel}, отправляем в GigaChat`);
  await bot.sendChatAction(chatId, 'typing');
  const response = await getGigaChatResponse(text, currentLevel);
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// --- Эндпоинт для веб-приложения (проверка первого канала) ---
app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  try {
    // Для веб-приложения достаточно проверить первый канал (основной)
    const sub1 = await checkSubscription(userId, CHANNEL1_ID, CHANNEL1_NAME);
    if (sub1.isMember) {
      await sendMainMenu(userId);
    }
    res.json({ ok: true, isMember: sub1.isMember });
  } catch (e) {
    console.error(`Ошибка проверки подписки для userId=${userId}:`, e.message);
    res.status(500).json({ ok: false, error: 'Ошибка проверки на стороне сервера.' });
  }
});

// --- Запуск сервера ---
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`✅ Webhook URL: ${webAppUrl}/webhook`);
});
