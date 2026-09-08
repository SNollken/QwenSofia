process.env.API_KEY = "";
// Porta fixa de teste: evita colisao com o servico em producao
// (dotenv nao sobrescreve variaveis ja definidas).
process.env.PORT = "3999";
process.env.QWEN_ACCOUNTS = "";
process.env.QWENBRIDGE_DB_PATH = "";
process.env.NODE_ENV = "test";
process.env.ACCOUNT_CREATOR_ENABLED = "false";
process.env.ACCOUNT_CREATOR_AUTO_AUTH = "false";
process.env.PREPARE_ALL_ON_STARTUP = "false";
process.env.DELETE_ALL_CHATS_ON_SHUTDOWN = "false";
process.env.SESSION_KEEP_ALIVE_ENABLED = "false";
