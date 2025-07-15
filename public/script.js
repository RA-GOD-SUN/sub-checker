document.addEventListener('DOMContentLoaded', () => {
    
    const CHANNEL_URL = 'https://t.me/1223234134134134' // ❗️ Ссылка на канал
    const SECRET_LINK = 'https://example.com/secret'; // ❗️ Ссылка переход после подписки

    const tg = window.Telegram.WebApp;
    tg.expand(); 

    const states = {
        initial: document.getElementById('initial-state'),
        loading: document.getElementById('loading-state'),
        success: document.getElementById('success-state'),
        errorNotSubscribed: document.getElementById('error-not-subscribed-state'),
        errorGeneral: document.getElementById('error-general-state'),
    };

    const checkButton = document.getElementById('check-button');
    const retryButton = document.getElementById('retry-button');
    const retryButtonGeneral = document.getElementById('retry-button-general');
    const channelLink = document.getElementById('channel-link');
    const secretLink = document.getElementById('secret-link');
    const errorMessage = document.getElementById('error-message');

    channelLink.href = CHANNEL_URL;
    secretLink.href = SECRET_LINK;

    const showState = (stateName) => {
        Object.values(states).forEach(state => state.classList.add('hidden'));
        if (states[stateName]) {
            states[stateName].classList.remove('hidden');
        }
    };

    const checkSubscription = async () => {
        showState('loading');
        
        if (!tg.initDataUnsafe || !tg.initDataUnsafe.user) {
            errorMessage.textContent = 'Не удалось получить данные пользователя Telegram. Пожалуйста, откройте приложение через Telegram.';
            showState('errorGeneral');
            return;
        }

        try {
            const res = await fetch('/api/check-sub', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: tg.initDataUnsafe.user.id })
            });

            if (!res.ok) {
                throw new Error(`Ошибка сервера: ${res.statusText}`);
            }

            const data = await res.json();

            if (data.ok && data.isMember) {
                showState('success');
            } else {
                showState('errorNotSubscribed');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            errorMessage.textContent = 'Не удалось выполнить проверку. Проверьте соединение и попробуйте позже.';
            showState('errorGeneral');
        }
    };

    checkButton.addEventListener('click', checkSubscription);
    retryButton.addEventListener('click', checkSubscription);
    retryButtonGeneral.addEventListener('click', checkSubscription);

    showState('initial');
});