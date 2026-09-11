import { config } from "../src/config.js";
import { getChat } from "../src/telegram.js";

const chat = await getChat(config.telegramToken, config.telegramChatId);
console.log("type:", chat.type);
console.log("title:", chat.title || chat.username || "");
console.log("commands work:", chat.type !== "channel" ? "YES (group/supergroup)" : "NO (channel)");
