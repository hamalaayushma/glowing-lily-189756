(function () {
  'use strict';

  const APP_KEY = 'payday-planner-v1';
  const SETTINGS_KEY = 'payday-planner-reminders-v1';
  const CHECK_INTERVAL = 30 * 60 * 1000;

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { enabled: false, sent: {} };
    } catch (error) {
      return { enabled: false, sent: {} };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      // Storage may be disabled or full; notifications can still work for this session.
    }
  }

  function loadPlanner() {
    try {
      const data = JSON.parse(localStorage.getItem(APP_KEY));
      if (data && Array.isArray(data.bills)) return data;
    } catch (error) {
      // Ignore malformed stored data.
    }
    return null;
  }

  function iso(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dateFromISO(value) {
    const parts = String(value).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function dueTomorrow(planner, tomorrow) {
    const due = [];
    const moves = planner.moves && typeof planner.moves === 'object' ? planner.moves : {};
    const paid = planner.paid && typeof planner.paid === 'object' ? planner.paid : {};

    planner.bills.forEach(function (bill) {
      if (bill.rec) {
        // Check surrounding months so month-end recurring payments are handled correctly.
        for (let offset = -1; offset <= 1; offset += 1) {
          const month = new Date(tomorrow.getFullYear(), tomorrow.getMonth() + offset, 1);
          const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          const original = new Date(month.getFullYear(), month.getMonth(), Math.min(Number(bill.day) || 1, lastDay));
          const occurrenceKey = bill.id + '@' + iso(original);
          const effective = moves[occurrenceKey] ? dateFromISO(moves[occurrenceKey]) : original;
          if (sameDay(effective, tomorrow) && !paid[occurrenceKey]) {
            due.push({ bill: bill, key: occurrenceKey, date: effective });
          }
        }
      } else {
        if (!bill.d) return;
        const original = dateFromISO(bill.d);
        const occurrenceKey = bill.id + '@' + iso(original);
        const effective = moves[occurrenceKey] ? dateFromISO(moves[occurrenceKey]) : original;
        if (sameDay(effective, tomorrow) && !paid[occurrenceKey]) {
          due.push({ bill: bill, key: occurrenceKey, date: effective });
        }
      }
    });
    return due;
  }

  async function notify(title, options) {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.showNotification) {
          await registration.showNotification(title, options);
          return;
        }
      } catch (error) {
        // Fall through to the page notification API.
      }
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, options);
    }
  }

  async function checkReminders() {
    const settings = loadSettings();
    if (!settings.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;

    const planner = loadPlanner();
    if (!planner) return;

    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const reminders = dueTomorrow(planner, tomorrow);
    const tomorrowKey = iso(tomorrow);
    settings.sent = settings.sent || {};

    // Keep only recent notification markers to avoid an ever-growing localStorage value.
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
    Object.keys(settings.sent).forEach(function (key) {
      if (key.slice(-10) < iso(cutoff)) delete settings.sent[key];
    });

    for (const reminder of reminders) {
      const sentKey = reminder.key + '|reminder|' + tomorrowKey;
      if (settings.sent[sentKey]) continue;
      const dateText = reminder.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      await notify('Payment due tomorrow', {
        body: reminder.bill.n + ' · ' + Number(reminder.bill.a || 0).toLocaleString(undefined, { style: 'currency', currency: 'AUD' }) + ' · due ' + dateText,
        icon: new URL('./icons/icon-192.png', document.baseURI).href,
        tag: sentKey,
        data: { url: document.baseURI }
      });
      settings.sent[sentKey] = true;
    }
    saveSettings(settings);
  }

  function renderSettings() {
    if (!document.body || document.getElementById('reminderSettings')) return;
    const nav = document.getElementById('tabs');
    const main = document.querySelector('main');
    if (!main) return;

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.id = 'reminderSettings';
    panel.innerHTML = '<h2>Payment reminders</h2>' +
      '<p class="hint">Get a notification one day before unpaid payments are due. Reminders are checked while this app is open or active in the browser. Enable browser notifications and allow this app to notify you.</p>' +
      '<button class="primary" id="reminderToggle" type="button"></button> ' +
      '<span id="reminderStatus" class="hint" role="status" aria-live="polite"></span>';
    main.insertBefore(panel, nav || main.firstChild);

    const button = document.getElementById('reminderToggle');
    const status = document.getElementById('reminderStatus');
    const refresh = function () {
      const settings = loadSettings();
      button.textContent = settings.enabled ? 'Turn off day-before reminders' : 'Enable day-before reminders';
      if (!('Notification' in window)) {
        status.textContent = 'Notifications are not supported by this browser.';
      } else if (Notification.permission === 'denied') {
        status.textContent = 'Notifications are blocked for this site. Allow them in browser/site settings, then try again.';
      } else if (settings.enabled && Notification.permission === 'granted') {
        status.textContent = 'Enabled. Reminders are checked while the app is open or active.';
      } else {
        status.textContent = 'Currently off.';
      }
    };

    button.addEventListener('click', async function () {
      const settings = loadSettings();
      if (settings.enabled) {
        settings.enabled = false;
        saveSettings(settings);
        refresh();
        return;
      }
      if (!('Notification' in window)) {
        refresh();
        return;
      }
      let permission = Notification.permission;
      if (permission === 'default') {
        try {
          permission = await Notification.requestPermission();
        } catch (error) {
          permission = 'denied';
        }
      }
      if (permission !== 'granted') {
        refresh();
        if (status) status.textContent = 'Permission was not granted. Change this site’s notification permission in your browser settings to enable reminders.';
        return;
      }
      settings.enabled = true;
      settings.sent = settings.sent || {};
      saveSettings(settings);
      refresh();
      checkReminders();
    });

    refresh();
  }

  renderSettings();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSettings, { once: true });
  }
  checkReminders();
  window.addEventListener('focus', checkReminders);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkReminders();
  });
  window.setInterval(checkReminders, CHECK_INTERVAL);
})();
