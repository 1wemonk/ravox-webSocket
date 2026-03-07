const ws = require('ws')
// const uuid = require('uuid')

const PORT = process.env.PORT || 5000;

function heartbeat() {
  this.isAlive = true;
}

const wss = new ws.Server({
  port: PORT,
}, () => {console.log('Server started! 5000')});

wss.on('connection', function connection(ws) {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (messageStr) => {
    // Лучше обернуть в try/catch, чтобы сервер не падал от битого JSON
    try {
      const data = JSON.parse(messageStr);
      console.log(data);

      switch (data.message.type) {
        case 'connect':
          // Сохраняем ключевые данные пользовтеля
          ws.roomId = data.room_id; // id комнаты, чтобы не попадать в чужие
          ws.userId = data.message.user_id; // ID юзера
          ws.userName = data.message.username; // имя юзера

          sendMessageToRoom(data);
          break;

        case 'PLAY_VIDEO':
          console.log(`Пользователь ${ws.userName} запустил видео`);
          sendMessageToRoom(data);
          break;

        case 'PAUSE_VIDEO':
          console.log(`Пользователь ${ws.userName} поставил на паузу`);
          sendMessageToRoom(data);
          break;

        case 'SEEK_VIDEO':
          console.log(`Пользователь ${ws.userName} перемотал на ${data.message.currentTime}`);
          sendMessageToRoom(data);
          break;

        case 'SYNC_STATE':
          console.log(`Синхронизация состояния для комнаты ${data.room_id}`);
          sendMessageToRoom(data);
          break;

        case 'message':
        case 'disconnect':
          sendMessageToRoom(data);
          break;
      }
    } catch (e) {
      console.error('Ошибка парсинга JSON:', e);
    }
  })

  ws.on('error', console.error);
})

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(wsConnect) {
    if (wsConnect.isAlive === false) {
      console.log('Terminating dead connection...');
      return wsConnect.terminate(); // Удаляем мертвое соединение
    }

    wsConnect.isAlive = false; // Сбрасываем флаг перед проверкой
    wsConnect.ping(); // Отправляем системный Ping
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

wss.on('disconnect', function disconnect(ws) {

})

function sendMessageToRoom(data) {
  wss.clients.forEach(client => {
    // 2. Фильтрация:
    // - client.roomId === data.room_id: отправляем только тем, кто в той же комнате
    // - client.readyState === ws.OPEN: проверяем, что соединение открыто

    if (client.roomId === data.room_id && client.readyState === ws.OPEN) {
      client.send(JSON.stringify(data.message));
    }
  })
}

// ПРОТОТИП СООБЩЕНИЯ
// const message = {
//   message: {
//     type: 'connect',
//     username: 'wemonk',
//     id: 'bc86b35d-38d3-40d8-acbf-7f9c8b19bca7',
//     message: 'Пользователь wemonk подключился!',
//     send_time: '21:12:45',
//     user_id: '3a9e97d2-4c59-46fd-97fb-b29c89fa6ab8',
//     avatar: ''
//   },
//   room_id: '419dd115-08f5-49ad-9541-da135facb5c7'
// }