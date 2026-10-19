// notice.js — ボタンの下の吹き出しに、background.js から渡された理由を表示する
document.getElementById("message").textContent = decodeURIComponent(location.hash.slice(1));
