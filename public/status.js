const title = document.querySelector('#status-title');
const message = document.querySelector('#status-message');

async function check() {
  try {
    const response = await fetch('/ready', { cache: 'no-store' });
    if (response.ok) {
      title.textContent = 'Service is ready';
      message.textContent = 'The application and database are available.';
      return;
    }
  } catch {
    // A cold service or temporary network loss is expected here.
  }
  title.textContent = 'Still waking…';
  setTimeout(check, 3000);
}

void check();
