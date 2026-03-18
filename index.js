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

// --- Хранилище истории и контекста (в памяти) ---
const userHistories = new Map(); // ключ: chatId, значение: массив сообщений { role, content }
const userContext = new Map();    // ключ: chatId, значение: объект с доп. полями (например, последняя тема, счётчик вопросов)
const MAX_HISTORY = 20; // увеличим, чтобы лучше видеть контекст

// --- Чтение переменных окружения ---
const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

// Канал 1 (обязательный)
const CHANNEL1_ID = process.env.CHANNEL1_ID;
const CHANNEL1_NAME = process.env.CHANNEL1_NAME || 'Основной канал';
const CHANNEL1_LINK = process.env.CHANNEL1_LINK;
const CHANNEL1_SHOW = process.env.CHANNEL1_SHOW !== 'false';

// Канал 2
const CHANNEL2_ID = process.env.CHANNEL2_ID;
const CHANNEL2_NAME = process.env.CHANNEL2_NAME || 'Дополнительный канал';
const CHANNEL2_LINK = process.env.CHANNEL2_LINK;
const CHANNEL2_SHOW = process.env.CHANNEL2_SHOW === 'true';
const CHANNEL2_REQUIRED = process.env.CHANNEL2_REQUIRED === 'true';

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

// ============================================================================
// ФУНКЦИИ ПРОВЕРКИ ПОДПИСКИ
// ============================================================================

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

async function getSubscriptionStatus(userId) {
  const statuses = [];

  if (CHANNEL1_ID) {
    const sub1 = await checkSubscription(userId, CHANNEL1_ID, CHANNEL1_NAME);
    statuses.push({
      id: CHANNEL1_ID,
      name: CHANNEL1_NAME,
      link: CHANNEL1_LINK,
      isMember: sub1.isMember,
      error: sub1.error,
      required: true,
      show: CHANNEL1_SHOW
    });
  }

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

function isFullySubscribed(statuses) {
  return statuses.every(ch => !ch.required || ch.isMember);
}

function formatUnsubscribedMessage(statuses) {
  const missingRequired = statuses.filter(ch => ch.show && !ch.isMember && ch.required);
  const missingOptional = statuses.filter(ch => ch.show && !ch.isMember && !ch.required);

  if (missingRequired.length === 0 && missingOptional.length === 0) return null;

  let text = '';
  const buttons = [];

  if (missingRequired.length > 0) {
    text += '❌ *Для доступа необходимо подписаться на следующие каналы:*\n\n';
    for (const ch of missingRequired) {
      text += `• ${ch.name}\n`;
      if (ch.link) {
        buttons.push([{ text: `📢 Подписаться на ${ch.name}`, url: ch.link }]);
      } else {
        text += `  (ссылка не указана, обратитесь к администратору)\n`;
      }
    }
    text += '\n';
  }

  if (missingOptional.length > 0) {
    if (missingRequired.length > 0) {
      text += '📢 *Дополнительные каналы (необязательно):*\n\n';
    } else {
      text += '📢 *Вы не подписаны на дополнительные каналы:*\n\n';
    }
    for (const ch of missingOptional) {
      text += `• ${ch.name}\n`;
      if (ch.link) {
        buttons.push([{ text: `📢 Подписаться на ${ch.name}`, url: ch.link }]);
      } else {
        text += `  (ссылка не указана, обратитесь к администратору)\n`;
      }
    }
    text += '\n';
  }

  if (missingRequired.length === 0) {
    text += 'Подписка на дополнительные каналы не обязательна, но даёт больше возможностей.\n';
  }

  text += 'После подписки нажмите /start или отправьте любое сообщение, чтобы проверить снова.';
  return { text, buttons };
}

// ============================================================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С ИСТОРИЕЙ В ПАМЯТИ
// ============================================================================

function addMessageToHistory(chatId, role, content) {
  if (!userHistories.has(chatId)) {
    userHistories.set(chatId, []);
  }
  const history = userHistories.get(chatId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.shift();
  console.log(`📝 История для ${chatId} обновлена, теперь ${history.length} сообщений`);
}

function getHistory(chatId) {
  return userHistories.get(chatId) || [];
}

function getUserContext(chatId) {
  if (!userContext.has(chatId)) {
    userContext.set(chatId, { lastTheme: null, questionCount: 0, lastSummaryIndex: 0 });
  }
  return userContext.get(chatId);
}

function updateUserContext(chatId, updates) {
  const ctx = getUserContext(chatId);
  Object.assign(ctx, updates);
  userContext.set(chatId, ctx);
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ АНАЛИЗА ДИАЛОГА
// ============================================================================

// Проверяет, не раздражён ли пользователь (по ключевым словам)
function isUserFrustrated(text) {
  const frustrationKeywords = [
    'повторяешь', 'одно и то же', 'по кругу', 'результата нет',
    'собираешься решать', 'устал', 'надоело', 'бесполезно',
    'не помогает', 'опять', 'снова'
  ];
  const lower = text.toLowerCase();
  return frustrationKeywords.some(keyword => lower.includes(keyword));
}

// Проверяет, не задавался ли уже похожий вопрос (грубая проверка)
function isQuestionRepeated(chatId, newQuestion) {
  const history = getHistory(chatId);
  // берём последние 5 сообщений бота (assistant)
  const lastBotMessages = history.filter(m => m.role === 'assistant').slice(-5);
  const newLower = newQuestion.toLowerCase();
  for (const msg of lastBotMessages) {
    if (msg.content.length > 20 && newLower.includes(msg.content.toLowerCase().substring(0, 30))) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// ОБРАБОТЧИКИ КОМАНД
// ============================================================================

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

bot.onText(/\/privacy|\/policy/, (msg) => {
  const chatId = msg.chat.id;
  const policyText = `
*ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ БОТА «Настройщик души»*  

1. *Какие данные собираются*  
   • Ваш Telegram ID — для проверки подписки на каналы и идентификации.  
   • Текстовые сообщения, которые вы отправляете боту — для генерации ответов через ИИ.  
   • Информация о подписке на каналы Nastroyshik_Dushi и Psy_Chat (только факт подписки).

2. *Как используются данные*  
   • Telegram ID и статус подписки — для предоставления доступа к функционалу.  
   • Сообщения — для обработки нейросетью GigaChat (Сбер) и формирования ответов.

3. *Передача третьим лицам*  
   • Сообщения передаются в GigaChat для обработки.  
   • Никакие данные не продаются и не передаются другим лицам.

4. *Хранение данных*  
   • История переписки не сохраняется на сервере после отправки ответа.  
   • Ваш ID хранится только для проверки подписки (в оперативной памяти).

5. *Ваши права*  
   • Вы можете в любой момент прекратить использование бота.  
   • Для удаления данных напишите администратору: @Nastroyschik_dushi (с пометкой «Удалить мои данные»).

6. *Контакты*  
   • По вопросам конфиденциальности: @Nastroyschik_dushi

Последнее обновление: 13 марта 2026 г.
  `;
  bot.sendMessage(chatId, policyText, { parse_mode: 'Markdown' });
});

// ============================================================================
// ГЛАВНОЕ МЕНЮ
// ============================================================================

async function sendMainMenu(chatId) {
  const menuMessage = `
✨ *Добро пожаловать в «Настройщик души»* ✨

Выберите тему, с которой хотите поработать (или просто напишите свой вопрос):

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

// ============================================================================
// УЛУЧШЕННАЯ ФУНКЦИЯ ДЛЯ GIGACHAT (с новым промптом и анализом)
// ============================================================================

async function getGigaChatResponse(userMessage, history, level = null, isFrustrated = false, repeated = false) {
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
    timeout: 120,
  });

  // --- Динамическая настройка промпта ---
  let systemPrompt = '';

  if (level && levelMap[level]) {
    // Специализированный промпт для темы (можно тоже улучшить)
    systemPrompt = getThemePrompt(level);
  } else {
    // Основной улучшенный промпт
    systemPrompt = `Ты — чуткий и внимательный психолог. Твоя задача — вести диалог так, чтобы человек чувствовал поддержку и понимание, а не усталость от бесконечных вопросов.

### Стиль общения:
- Начинай с эмпатии: "Я слышу тебя", "Понимаю, это непросто", "Спасибо, что поделился".
- После 2-3 вопросов подряд обязательно давай краткое резюме того, что понял, и предлагай небольшое упражнение, совет или инсайт.
- Избегай повторения одних и тех же вопросов — используй историю диалога.
- Если человек проявляет раздражение (говорит "ты повторяешься", "по кругу", "результата нет"), извинись и смени тактику: предложи подвести итог, дай простое задание или предложи сделать паузу.
- В конце каждого ответа можешь оставлять пространство для ответа, но не перегружай вопросами. Лучше один хороший вопрос, чем три поверхностных.
- Если видишь, что человек зашёл в тупик, предложи конкретное маленькое действие (например, "попробуй сейчас сделать глубокий вдох и выдох" или "запиши одну мысль, которая пришла").

### Техники, которые можно использовать:
- Признание: "Просто признай это чувство и дай ему место".
- Работа с частями: "Какая часть тебя так говорит? А что хочет другая?".
- Метафоры: "Если бы это было похоже на что-то в природе, на что?".
- Простые упражнения: дыхание, заземление, маленькие шаги.

Помни: твоя цель — помочь человеку найти свой путь, а не засыпать его вопросами. Будь бережным.
`;
  }

  // Если пользователь раздражён, добавим инструкцию извиниться и сменить стиль
  if (isFrustrated) {
    systemPrompt += '\n\n⚠️ Пользователь проявляет раздражение (жалуется на повторения или отсутствие результата). Начни ответ с извинения, предложи подвести краткий итог диалога и дай одно конкретное упражнение или совет. Сократи количество вопросов.';
  } else if (repeated) {
    systemPrompt += '\n\n⚠️ Похоже, что твой предыдущий вопрос повторялся. Постарайся задать новый, более глубокий вопрос или дай обратную связь.';
  }

  // Собираем сообщения для GigaChat: системный промпт + история + текущее сообщение
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // Повторные попытки при ошибках
  const maxRetries = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[GigaChat] Попытка ${attempt}, сообщение: "${userMessage.substring(0,50)}..."`);
      const response = await client.chat({
        messages: messages,
        temperature: 0.8,
        max_tokens: 350 // немного увеличим, чтобы было место для резюме
      });
      const answer = response.choices[0]?.message.content || 'Не удалось сгенерировать ответ.';
      console.log(`[GigaChat] Ответ получен, длина: ${answer.length}`);
      return answer;
    } catch (error) {
      lastError = error;
      console.error(`[GigaChat] Ошибка (попытка ${attempt}):`, error.message);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  console.error('[GigaChat] Все попытки исчерпаны:', lastError);
  return '🚧 Извините, нейросеть временно не отвечает. Попробуйте чуть позже.';
}

function getThemePrompt(level) {
  const prompts = {
    'Безопасность': `Ты — психолог, тема "Безопасность" (тревога, страх). Проявляй эмпатию. После 2-3 вопросов давай резюме и предлагай простое упражнение на заземление.`,
    'Принятие': `Ты — психолог, тема "Принятие" (одиночество, любовь). Помоги человеку исследовать его чувства, но не перегружай вопросами. После обсуждения предложи записать три вещи, за которые он благодарен сегодня.`,
    'Понимание себя': `Ты — психолог, тема "Понимание себя". Задавай открытые вопросы, но чередуй с рефлексией. Предложи вести дневник мыслей.`,
    'Смысл': `Ты — психолог, тема "Смысл". Помоги искать внутри себя. Если чувствуешь тупик, предложи подумать о том, что приносило радость в прошлом.`,
    'Свобода': `Ты — психолог, тема "Свобода". Исследуй ограничения, но также предлагай маленькие шаги для расширения пространства выбора.`
  };
  return prompts[level] || prompts['Понимание себя'];
}

const levelMap = {
  '🌿 Безопасность': 'Безопасность',
  '💗 Принятие': 'Принятие',
  '🧩 Понимание себя': 'Понимание себя',
  '🌟 Смысл': 'Смысл',
  '🕊️ Свобода': 'Свобода'
};

// ============================================================================
// ОСНОВНОЙ ОБРАБОТЧИК СООБЩЕНИЙ
// ============================================================================

bot.on('message', async (msg) => {
  console.log('=== ВХОДЯЩЕЕ СООБЩЕНИЕ ===');
  console.log('Chat ID:', msg.chat.id);
  console.log('Текст:', msg.text);

  const chatId = msg.chat.id;
  const text = msg.text;

  if (chatId < 0) {
    console.log('⚠️ Сообщение из группы/канала, игнорируем');
    return;
  }

  if (text.startsWith('/')) {
    console.log('Игнорируем команду');
    return;
  }

  // --- 1. Проверка подписки ---
  console.log('🔐 Получаем статус подписки...');
  const statuses = await getSubscriptionStatus(chatId);
  const fullySubscribed = isFullySubscribed(statuses);
  console.log(`🔐 Полностью подписан на обязательные: ${fullySubscribed}`);

  const unsubInfo = formatUnsubscribedMessage(statuses);
  if (unsubInfo) {
    console.log('❌ Пользователь не подписан на некоторые каналы (показываем)');
    await bot.sendMessage(chatId, unsubInfo.text, {
      reply_markup: { inline_keyboard: unsubInfo.buttons }
    });
    if (!fullySubscribed) return;
  }

  // --- 2. Получаем историю и контекст ---
  const history = getHistory(chatId);
  const context = getUserContext(chatId);
  console.log(`📖 История для ${chatId}: ${history.length} сообщений, вопросов: ${context.questionCount}`);

  // --- 3. Определяем, является ли сообщение выбором темы из меню ---
  const selectedLevel = levelMap[text];
  if (selectedLevel) {
    addMessageToHistory(chatId, 'user', text);
    context.lastTheme = selectedLevel;
    context.questionCount = 0; // сброс счётчика для новой темы
    console.log(`✅ Пользователь выбрал тему: ${selectedLevel}`);

    await bot.sendChatAction(chatId, 'typing');
    const response = await getGigaChatResponse(text, history, selectedLevel);
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    addMessageToHistory(chatId, 'assistant', response);
    return;
  }

  // --- 4. Анализ сообщения на раздражение и повторения ---
  const isFrustrated = isUserFrustrated(text);
  let isRepeated = false;
  if (!isFrustrated && context.lastTheme) {
    // Проверим, не повторяется ли вопрос (если есть тема)
    const lastBotMessage = history.filter(m => m.role === 'assistant').slice(-1)[0]?.content;
    if (lastBotMessage && lastBotMessage.includes('?')) {
      // грубая проверка
      isRepeated = true; // для демонстрации, можно улучшить
    }
  }

  // --- 5. Сохраняем сообщение пользователя ---
  addMessageToHistory(chatId, 'user', text);
  context.questionCount++;

  // --- 6. Если пользователь раздражён, сбрасываем счётчик и реагируем особо ---
  if (isFrustrated) {
    console.log('⚠️ Пользователь раздражён');
    context.questionCount = 0; // чтобы не накручивать
  }

  // --- 7. Получаем ответ от GigaChat с учётом контекста ---
  await bot.sendChatAction(chatId, 'typing');
  const response = await getGigaChatResponse(
    text,
    history,
    context.lastTheme,
    isFrustrated,
    isRepeated
  );
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  addMessageToHistory(chatId, 'assistant', response);

  // --- 8. Если счётчик вопросов достиг 3, можно добавить служебное сообщение (но это уже в промпте) ---
  if (context.questionCount >= 3 && !isFrustrated) {
    console.log(`🔔 Пользователь ответил на ${context.questionCount} вопросов подряд. Бот должен дать резюме.`);
    // резюме уже должно быть в ответе благодаря промпту
  }

  // Обновляем контекст (questionCount уже увеличен)
  updateUserContext(chatId, { questionCount: context.questionCount });
});

// ============================================================================
// ЭНДПОИНТ ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ
// ============================================================================

app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  try {
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

// ============================================================================
// ЗАПУСК СЕРВЕРА
// ============================================================================

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`✅ Webhook URL: ${webAppUrl}/webhook`);
});
