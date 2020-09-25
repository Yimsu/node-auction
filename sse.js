/*
SSE(서버센트) : 서버에서 클라이언트로 업데이트를 스트리밍 할 수 있다.
서버와 클라이언트 사이에 단일 단방향 채널을 연다
브라우저에서 직접 처리가 되므로 사용자는 메시지를 청취해야한다
 */

const SSE = require('sse');

module.exports = (server) => {
    const sse = new SSE(server); //익스프레스 서버로 서버객체 생성

    sse.on('connection', (client) => { // 서버센트이벤트 연결
        //클라이언트가 메시지를 보낼때 사용
       setInterval(() => {
            client.send(Date.now().toString());
        }, 1000); //1초마다 접속한 클라이언트에 서버 시간 타임스탬프를 보내도록함
    });
};