const SocketIO = require('socket.io');

module.exports = (server, app) => {
    // 실시간으로 입찰 정보를 올리기 위해 웹 소켓을 사용
    const io = SocketIO(server, { path: '/socket.io' });
    app.set('io', io);

    io.on('connection', (socket) => { // 웹 소켓 연결 시
        const req = socket.request;
        const { headers: { referer } } = req; //주소로
        // 경매장 아이디를 받아와서
        const roomId = referer.split('/')[referer.split('/').length - 1];
        socket.join(roomId); //  방에 입장한다
        socket.on('disconnect', () => {
            socket.leave(roomId); // 연결이 끊어지면 방에서 나간다
        });
    });
};