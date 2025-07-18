// check-winner.js (giữ nguyên)
const fs = require("fs");

// 🔢 Kết quả xổ số thực tế (điền vào đây mỗi lần chơi)
const winningNumbers = ["05", "17", "22", "88", "99"]; // ví dụ, thay đổi theo thực tế

// 📥 Đọc file người chơi đã lọc từ index.js
const players = require("./players.json");

// 🎯 Đếm người trúng
let winners = [];

winningNumbers.forEach((num) => {
  players.forEach((player) => {
    if (player.number === num) {
      const existing = winners.find((w) => w.fid === player.fid);
      if (existing) {
        existing.hits += 1;
      } else {
        winners.push({
          ...player,
          hits: 1,
        });
      }
    }
  });
});

if (winners.length === 0) {
  console.log("❌ Không có người trúng lần này.");
  process.exit(0);
}

console.log(`🎉 Tổng cộng có ${winners.length} người trúng:\n`);

winners.forEach((w, i) => {
  const reward = (1.1 * w.hits).toFixed(2);
  console.log(
    `#${i + 1}: @${w.username} trúng số ${w.number} (${w.hits} lần) → thưởng ${reward} USDC`
  );
});

console.log("\n📝 Gợi ý nội dung trả lời từng người:\n");
winners.forEach((w) => {
  const reward = (1.1 * w.hits).toFixed(2);
  console.log(
    `➡️ Trả lời @${w.username}: "🎉 Chúc mừng bạn đã trúng số ${w.number} (${w.hits} lần)! Bạn nhận được ${reward} USDC. Phần thưởng sẽ được gửi trực tiếp vào ví của bạn. 💜"`
  );
});