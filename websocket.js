const ws = require('ws')

const PORT = process.env.PORT || 5000;

// Хранилище комнат: roomId -> { hostId: string, users: Map<userId, ws> }
const rooms = new Map();

function heartbeat() {
  this.isAlive = true;
}

const wss = new ws.Server({
  port: PORT,
}, () => {console.log('Server started! 5000')});

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { hostId: null, users: new Map() });
  }
  return rooms.get(roomId);
}

function assignHost(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.users.size === 0) return null;

  // Берём первого пользователя как хоста
  const firstUser = room.users.keys().next().value;
  room.hostId = firstUser;

  // Уведомляем всех о смене хоста
  broadcastToRoom(roomId, {
    type: 'host-assigned',
    userId: firstUser,
    username: room.users.get(firstUser)?.userName || 'Unknown'
  });

  return firstUser;
}

function broadcastToRoom(roomId, message, excludeUserId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.forEach((client, userId) => {
    if (userId !== excludeUserId && client.readyState === ws.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function sendToUser(roomId, targetUserId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  const client = room.users.get(targetUserId);
  if (client && client.readyState === ws.OPEN) {
    client.send(JSON.stringify(message));
  }
}

wss.on('connection', function connection(ws) {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      console.log('[WS Message]', `type ${data.message?.type}`, 'from', data.message?.userId || data.message?.user_id, ' : ', data.message.username);

      const msg = data.message;
      const roomId = data.room_id;

      switch (msg.type) {
        case 'connect': {
          ws.roomId = roomId;
          ws.userId = msg.userId || msg.user_id; // поддерживаем оба варианта
          ws.userName = msg.username;

          const room = getOrCreateRoom(roomId);
          room.users.set(ws.userId, ws);

          // Если нет хоста — назначаем текущего
          if (!room.hostId) {
            room.hostId = ws.userId;
            msg.isHost = true; // помечаем в сообщении
          }

          // Отправляем текущему пользователю инфу о хосте
          ws.send(JSON.stringify({
            type: 'host-info',
            hostId: room.hostId,
            isHost: room.hostId === ws.userId
          }));

          // Уведомляем комнату о подключении
          broadcastToRoom(roomId, {
            type: 'connect',
            userId: ws.userId,
            username: ws.userName,
            message: `Пользователь ${ws.userName} подключился!`,
            send_time: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit', second:'2-digit'}),
            timestamp: Date.now()
          }, ws.userId);
          break;
        }

        case 'message': {
          broadcastToRoom(roomId, {
            ...msg,
            user_id: msg.userId || msg.user_id, // нормализуем для клиента
            send_time: msg.send_time || new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit', second:'2-digit'})
          });
          break;
        }

        // WebRTC Signaling — критически важно: отправляем конкретному пользователю
        case 'screen-share-offer': {
          console.log('[Server] Forwarding offer from', msg.userId, 'to', msg.targetUserId);
          if (msg.targetUserId) {
            sendToUser(roomId, msg.targetUserId, {
              type: 'screen-share-offer',
              offer: msg.offer,
              userId: msg.userId,
              targetUserId: msg.targetUserId
            });
          }
          break;
        }

        case 'screen-share-answer': {
          if (msg.targetUserId) {
            sendToUser(roomId, msg.targetUserId, {
              type: 'screen-share-answer',
              answer: msg.answer,
              userId: msg.userId,
              targetUserId: msg.targetUserId
            });
          }
          break;
        }

        case 'ice-candidate': {
          if (msg.targetUserId) {
            sendToUser(roomId, msg.targetUserId, {
              type: 'ice-candidate',
              candidate: msg.candidate,
              userId: msg.userId,
              targetUserId: msg.targetUserId
            });
          }
          break;
        }

        case 'request-screen-share': {
          // Пересылаем запрос хосту (если это не сам хост запрашивает)
          const room = rooms.get(roomId);
          if (room && room.hostId && room.hostId !== msg.userId) {
            sendToUser(roomId, room.hostId, {
              type: 'request-screen-share',
              userId: msg.userId,
              username: msg.username
            });
          }
          break;
        }

        case 'screen-share-stopped': {
          broadcastToRoom(roomId, {
            type: 'screen-share-stopped',
            userId: msg.userId,
            username: msg.username
          });
          break;
        }

        case 'PLAY_VIDEO':
        case 'PAUSE_VIDEO':
        case 'SEEK_VIDEO':
        case 'SYNC_STATE': {
          // Видео-команды только от хоста всем остальным
          broadcastToRoom(roomId, msg, msg.userId);
          break;
        }

        case 'disconnect': {
          // Ручной disconnect от клиента
          handleDisconnect(ws);
          break;
        }
        case 'screen-share-started': {
          // Broadcast всем кроме отправителя (хоста)
          broadcastToRoom(roomId, {
            type: 'screen-share-started',
            userId: msg.userId,
            username: msg.username,
            timestamp: Date.now()
          }, msg.userId);
          break;
        }
      }
    } catch (e) {
      console.error('Ошибка обработки сообщения:', e);
    }
  });

  ws.on('error', console.error);

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

function handleDisconnect(ws) {
  if (!ws.roomId || !ws.userId) return;

  const room = rooms.get(ws.roomId);
  if (!room) return;

  room.users.delete(ws.userId);

  // Уведомляем комнату
  broadcastToRoom(ws.roomId, {
    type: 'disconnect',
    userId: ws.userId,
    username: ws.userName,
    message: `Пользователь ${ws.userName} вышел!`,
    send_time: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit', second:'2-digit'})
  });

  // Если ушёл хост — переназначаем
  if (room.hostId === ws.userId) {
    const newHostId = assignHost(ws.roomId);
    console.log(`Host left room ${ws.roomId}, new host: ${newHostId}`);
  }

  // Если комната пуста — удаляем
  if (room.users.size === 0) {
    rooms.delete(ws.roomId);
    console.log(`Room ${ws.roomId} deleted (empty)`);
  }
}

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(wsConnect) {
    if (wsConnect.isAlive === false) {
      console.log('Terminating dead connection...');
      wsConnect.terminate();
      return;
    }
    wsConnect.isAlive = false;
    wsConnect.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

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