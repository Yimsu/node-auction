const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const schedule = require('node-schedule');//서버를 계속 켜놔야 스케줄예약이 진행됨, 꺼지면 종료됨

const { Good, Auction, User } = require('../models');
const { isLoggedIn, isNotLoggedIn } = require('./middlewares');

const router = express.Router();

router.use((req, res, next) => {
    // 모든 pug 템플릿에 사용자 정보를 변수로 집어 넣음
    // 이렇게 하면 res.render 메서드에 user: req.user를 하지 않아도 됨
    res.locals.user = req.user;
    next();
});

// 메인화면 렌더링, 렌더링할때 경매가 진행중인 상품 목록도 같이 불러옴
router.get('/', async (req, res, next) => {
    try {
        // SoldId: null 낙찰자가 null이면 경매가 진행중인 것
        const goods = await Good.findAll({ where: { SoldId: null } });
        res.render('main', {
            title: 'NodeAuction',
            goods,
        });
    } catch (error) {
        console.error(error);
        next(error);
    }
});

//회원가입
router.get('/join', isNotLoggedIn, (req, res) => {
    res.render('join', {
        title: '회원가입 - NodeAuction',
    });
});

//상품 등록
router.get('/good', isLoggedIn, (req, res) => {
    res.render('good', { title: '상품 등록 - NodeAuction' });
});

try {
    fs.readdirSync('uploads');
} catch (error) {
    console.error('uploads 폴더가 없어 uploads 폴더를 생성합니다.');
    fs.mkdirSync('uploads');
}
const upload = multer({
    storage: multer.diskStorage({
        destination(req, file, cb) {
            cb(null, 'uploads/');
        },
        filename(req, file, cb) {
            const ext = path.extname(file.originalname);
            cb(null, path.basename(file.originalname, ext) + new Date().valueOf() + ext);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
});

// 사진 등록
router.post('/good', isLoggedIn, upload.single('img'), async (req, res, next) => {
    try {
        const { name, price } = req.body;
        const good = await Good.create({
            OwnerId: req.user.id,
            name,
            img: req.file.filename,
            price,
        });
        const end = new Date();
        end.setDate(end.getDate() + 1); // 하루 뒤
        //일정 예약,   scheduleJob(실행될시간, 해당시각이됐을떄 수행할 콜함수)
        schedule.scheduleJob(end, async () => {
            const success = await Auction.findOne({
                where: { GoodId: good.id },
                order: [['bid', 'DESC']],
            });
            await Good.update({ SoldId: success.UserId }, { where: { id: good.id } });
            await User.update({
                // 낙찰자의 보유자산을 낙찰 금액만큼 뺀다
                money: sequelize.literal(`money - ${success.bid}`),
            }, {
                where: { id: success.UserId },
            });
        });
        res.redirect('/');
    } catch (error) {
        console.error(error);
        next(error);
    }
});

// 해당 상품과 기존 임찰 정보들을 불러온뒤 렌더링한다.
router.get('/good/:id', isLoggedIn, async (req, res, next) => {
    try {
        const [good, auction] = await Promise.all([
            Good.findOne({
                where: { id: req.params.id },
                include: {
                    model: User,
                    as: 'Owner', //as 속성 주의!! 일대다 관계가 두번 연결되어있어서 as속성으로 밝혀야함
                },
            }),
            Auction.findAll({
                where: { GoodId: req.params.id },
                include: { model: User },
                order: [['bid', 'ASC']],
            }),
        ]);
        res.render('auction', {
            title: `${good.name} - NodeAuction`,
            good,
            auction,
        });
    } catch (error) {
        console.error(error);
        next(error);
    }
});

// 클라이언트로부터 받은 입찰 정보를 저장한다
router.post('/good/:id/bid', isLoggedIn, async (req, res, next) => {
    try {
        const { bid, msg } = req.body;

        const good = await Good.findOne({
            where: { id: req.params.id },
            include: { model: Auction },
            // Auction모델의 bid를 내림차순으로 정렬
            order: [[{ model: Auction }, 'bid', 'DESC']],//include될 모델의 컬럼을 정렬

        });
        if (good.price >= bid) {
            return res.status(403).send('시작 가격보다 높게 입찰해야 합니다.');
        }
        if (new Date(good.createdAt).valueOf() + (24 * 60 * 60 * 1000) < new Date()) {
            return res.status(403).send('경매가 이미 종료되었습니다');
        }
        if (good.Auctions[0] && good.Auctions[0].bid >= bid) {
            return res.status(403).send('이전 입찰가보다 높아야 합니다');
        }
        // 정상적인 입찰가가 들어왔다면 저장한다.
        const result = await Auction.create({
            bid,
            msg,
            UserId: req.user.id,
            GoodId: req.params.id,
        });
        // 실시간으로 입찰 내역(입찰자, 입찰 가갹, 입찰메시지)등을 웹소켓으로 전달
        req.app.get('io').to(req.params.id).emit('bid', {
            bid: result.bid,
            msg: result.msg,
            nick: req.user.nick,
        });
        return res.send('ok');
    } catch (error) {
        console.error(error);
        return next(error);
    }
});


// 낙찰자가 낙찰 내역을 볼 수 있도록
router.get('/list', isLoggedIn, async (req, res, next) => {
    try {  //닉칠된 상품과 상품의 입찰내역을 조회
        const goods = await Good.findAll({
            where: { SoldId: req.user.id },
            include: { model: Auction },
            order: [[{ model: Auction }, 'bid', 'DESC']],
        });
        res.render('list', { title: '낙찰 목록 - NodeAuction', goods });
    } catch (error) {
        console.error(error);
        next(error);
    }
});

module.exports = router;