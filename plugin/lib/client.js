// dsh-ldvh — LD Vibe Harness client-plane plugin.
//
// Registers three contributions:
//   1. plugins.item (list "dsh-ldvh")  — the plugin settings card on the
//      Plugins page: governed-project management, default governance
//      directory, route switch. (Was `settings.plugin.item` before DSH 0.1.7
//      removed that keyed slot — 调研报告 §3.3.)
//   2. conversation.view (list/session "ldvh")   — the LDVH view tab beside
//      chat / trajectory in the conversation header; clicking it renders the
//      LDVH Web in the session body (iframe /ldvh/ with loading / error /
//      retry states).
//   3. betterSidebar tab "dsh-ldvh:web" (soft-injected) — the same Web in the
//      right sidebar, when a better-sidebar service is present.
//
// Presentation decision (Human-confirmed): LDVH renders like
// thinking/context/trajectory — a session-scoped view inside the conversation
// area — NOT a sidebar entry + fullscreen overlay. The conversation.view
// registration mirrors dsh-client-ui-trajectory.
//
// Settings transport (DSH 0.1.7+): the removed `ctx.settingsScope` is replaced
// by `ctx.configForms.get(<profile entry id>)`; the write path changed from
// `scope.set(key, value)` to a revision-fenced `scope.mutate(ops, revision)`.
// configForms is injected SOFTLY — without it the placements still mount
// (default-on) and the settings card is simply absent.
//
// Plain JS only (no bundler transform): React.createElement, CSS injected as a
// style tag, locale registered per namespace.

window.__ModuleLoader__.load({
  id: "dsh-ldvh",
  factory: function (require) {
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Toast = primitives.Toast;
    // ── 图标族探测（DSH 0.1.7 起重命名）──────────────────────────────────
    //
    // 原此处探测 `IconChevronDown`（旧名 IconChevronDownOutline14 → 新名
    // …Regular/…Medium），供设置卡的折叠箭头使用。设置卡已删除（见下方
    // 「设置卡组件已删除」那段），箭头随之无消费点，故**探测一并移除**。
    //
    // **保留这条注释的理由**：图标族的重命名是宿主的既成事实，将来要加图标时
    // 仍需按名探测 + 缺失退回自绘（把 undefined 交给 React.createElement 会在
    // 渲染期抛错）。此处记下这个坑，避免下次重新踩一遍。

    // ── icon: the real 64px LDVH package icon, matching WorkBuddy's pattern ──
    var LDVH_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAXGUlEQVR4nH1bC7BdVXn+1tr7nHPvzb3JvUloSAQp0JHWoAMttKOCFrWU8irQSbCTQYG21IahnTJUUTsM0FJhZCzCSIcKImOpDkhrhQ5YC7ROB3lUBU3EyCuBFBIIedzcx3ntvTr/a621TwIns3PO3mfvddf/+v7v/9c6DvYKoYBz1cZNYfJpVBcNBm7dcIhj3TBM15VzqAE6XAWEGggVADroOl0byDW+PtRr9E732rl9r2PxOMNsrCogVE7PA0Kge4Lcz5/TGI6v00UaK+h98u4QUA9quIDg4Pe2i2LTsknc++mzZu9cv37VHNaFAveSJICj/9aFUNzrXHXSTwdnznl/Y+X9MaEP1D0A/ToKaUdDASoAK0YVYcLad/G88S6C1aQcOkI2Nj9HylBFBRMYqPUeFp6EDXQfKcIUoud6LQQP59rwrsBEOdhy9KGDK/7j9mUPmBKcCf++Z4YbF6eKLw+6QFioKl/DoYILlXMsHE2KPCCzwlsqoNb3oUw4Kq+2a0k4G4MtXOX3J4HNyulzUkC0eqYI8ZAaQZQSAh9080Qx1m7jHStnL/3B3ctvXbcuFOwBH/p5OG12DA/29leV6wcHeI8hadE1rBldl/6ACs7WMEuz0PIcKawe0Gdzeyf36eTzcOHxVAEpTEQB0QtY0PRZPMYsX+t3tSqBxkteYeHh6qqu6yIsmVhaHHtE7/fu/8fJhzzF/OywunXQR+DJOO9pkLp2NJ64pIXhaOxb/IfmJM29PemSJ+NSzJP1s2dhwmucJ6uaoIYFzVjnkFDhLRTkb2XC03gQTKDrZNjSV1icXwzPv9y99Z5Hw6R/psQnqoniyLBQ1d65IoGiDqZuHwWwzyFzx8xl5RDBZR4uCZc9E8fS+8TdSfHZ2KxAel6VwEIYZiflxC9NKToeKcKrAcjV2d2DK3xYqOcXJ478ytf2fcL3htWGegAaSZGeBnKixWgVPXRiZpEomLq4Kcri2RCc7zN3NWuq5XlOJLwqjq9liqlHlEfzSveIdVk0Fjh5kVjdjKLneniCtcEg7N492FBWAWvrHpwLzgmYUfySi+VorcJFBE6I7jIAjFnC3DybePKE5ClxLLsPI0q3kNAsYJ4g1wjkzDuju4nQJrx6RxRe/7YHfFX3MOyHtaUHloaKcqa4rcQTDWxubHnZ0lESNoaGXad7+RmLc7GMxbS4s8Y82S3mdhMshR+Po4pk181jkx22afHc8hL3plNTjOGDjEfu7pxfWkpcyA02Ofo6xpylPsMCi3eNTROShVawM0H4+4bXaGqzcTKQzc8j6VGPkb9tFtU56bwlBdK9ZMQMKNgolMtVKepFcq6hBMAzQJAQ6srG9iwNJRfN0LtWd64z1qZjRPDieBYQkyNTqFpCsoYoKQFoFt8xhA5icZ2fXWOwY4GScsT95Tv7XoSnd0ehgLJBSPSdkdhYWbSeAk2eCSzuScDs/qQo9dpRZarVWWm5ZRuxn8YRRabYtiwhn5PVRXD9js8FzM2rowKII7MnOJSR2GSZJMVUckfzjIjKMe2p5fOsENGfPESR38AwB8AsZTUBUV025TwWVEAsubSl6gYA8rU6eUMmvE2ErjMrQEDZQGkewGI6TcqPAhlT1hHBBV0xZC/R3B09JFmdXDESrIz5GRPMlWQA6kNAoVbjf7FAyq1vsW8xrt+rImI4aEiwIuqAMjI9y/8Z5RSAS+f04P4uTcihozDLaO6kZup2gSWFIXjm3plb75sHxkugMKzAgWmQcYmsTvqrgPkuMOgHFAhY0gnolDJfOgTM0t/xMcYTJeZz9QZRgHiUd5AQIHe2fNqIY3o4xiEw3wc++A6HvzweWNbWtKmsrF853PFEwDd/LEqoVOiYQQLQ7QGXn+Zw3okOhc9i1tw8umpS7mBQ4PW9Ab/YVuHxTTV+8EyF7TsqTHQCxtsBlVWSUVBViGYHcnMDQvaUyAv03wmPDcP8ECiy2lwOKl4CFz2+AoYDx1b73rkOayaVfUXziRMu9oGTbg54cz9pNlV9FEJzi8CJv+zwwOWWoZvZfXSst3rteDPgXx4e4LZv9fDS9grLlzotkclDakmXJCCFTswAdC5eZQqphwErZgr40QInAh4XHMbsHGt6ugSmWuLZwyqwlclFhwqOrSJgZky+izydc7bj+1ZPy7P9AT2nz/MR+PuK/g6/50fg8QdDGffQFQ4b13fwyFcmccl5HczOUgVYoXTcAGEBSWBzdRY4hoLUBvGeQGFgrM84gMWglq/mwszXqcSlAahgdi57l8/Mr9gaxiqbnZwheZMU23Lw88zN0zWff5ZzCpeyAApqTNWkjBorljnceMUEbvnMEqK0qIc1A6UAnYQS5/6Md4jTNxlhGUkKRYYBHmHCiEewJxQjzmmenFdphiXsZ0aKstogvmwkEiqwYml6MmS6kQkQKcUlICsIY6hyDAEbzupgZgr448/OouyI5Y3t8YgGfq5OIaHfeiZDWXclFizWw1OmF0lRQ4A8UWevnPTEsTNFjoQ7fV0UDq3SoSyBVgmU/FmOVsuz9VmfrCUBMPIMut4f1Dj9tzv4wqcmORzIvW1qwgOcYIC5vB0gzAClQW1EGuJXkgql2MlyuTHFhg4OAlrm8vRxtHrMFUhRV4trv/hawK3fqbF/QSwoYwSUPuCwlcDJ7y3wgeMKFHAYDgN7gOmwLBwGgxobzhnH/z7Txz9/exErpz2HK1teUZ+tTSGXZYZCFGAc3eqBZsESmZs1L0e92HK5TikSKA2N2CMY8QATfuvOgLOvqrBlW0CnyOioeWVF1/v4rXd7/M2fjeGEtQWGFO+FpkzFFPKOv/7zKXz/sR5m99foUJ2rRRNhhwCfAqBOxQkbVObHKSv14UZb2KnFdBAl5CdxvMwDcnotrTsW/vW9wPnXVdi2M+DwQ4DVK4CZSWDFVDp+aRkwNR7wxE8GOOuyWdz3vT7K0jMGyN8ToKTzFTMel2yYwPxcAJe56voR/eO7tOscY0Ls2GSFkJW+Nue8QTn6agJD6gta5mhwf7mHhCdesOGGCpu3AmMthzv+qsTHf6fArj0SP5YGKXNQZpleArRcjU9ePYdHnxgwPrAStK1EXkBhvO7scRx+aIleL2SWTzFP1qdQYkCs6dx66COob/28mB61GjzACwhmc9Q2rxnt/9GfUGwY1g4XfbHG488GjLWAmzYWOOU4zwAoKG6KteYG8YSAdunQKQM+dcMc9uwLbHnRv9Baumf5dIGPnNTB4jx5gQjNgisNLuH0Gr07ygKpjpdKsFnWGiuMXtLwfaPDpoRk/dFqjcYht6Q7P3lzhQefqvn87y4usOEjkgpjYlHhyT2psjMLErOcHANe3DbAXfd1xfUZVzRH6qMf/VA7E15JkfECdX9TiB+11ughDcisQGr4+wEfDqzrtegRxAau+aca3/gvEejK8z0uOcNhsUfWtAJGviOhrWKLXRwujgImx4Fvf3cR3V7gLGBRyDnfBbxnbQurVlImqJlEmdtLSpS/I9dACpD0l+I+sTjLCNbLe3sekHlEJry5/tJxh/98usZtDwo1vfTsAp/+mMeA0hrnPssalgl0PtoEEUYn18fbDltfHmLzlgEcs0MtiZ0oY+UKjyPWlBj0lRVGy3s+J2VQreKZIGUWq7MFDMEBaW01yMyoC7iRwmikG0zaZo5BcTwE9s0FXPS7Hp+/2DO356rQquKsvy9NDWV2yuXlM4Eb0O8FbN4ieTnCheIAKWLNao9qKPm/gJdD6bfhQkHlMLE9QmouF7Mlq1geM/hpO2xU/oNciT2K2B0Wik1/cHYu4Jz3O9y80bNXCOAJfnCzRAeguUhxbF0e7eLwMyIUKeW1HRkoWS9QXzPTnmWQvoOkQMED5Q8UDnDUE0ytLVv6jtbTyae6IP8T2qczNhKbAymLWP4nwXp94IhVDv9wWcGWoBRHHD/Fr8NPn6/Q8lpFpqCKwEgCGLsjF+4umOs3nZJeS8Y8ilrSHV0kazPqq6J5BRQylsgR4z2rALXhmWWkt8CAZvES49/aYDTZXsDxRzksnaDcTqAnz5DLtkqPux8c4LuPDTjfE9rnq0ziFUpotJfH4WFdjthUSbOjMdjFSXCtWg0EyyC9DU+fWcNq6UaDMq7tExJn6fFt3J+vKmPkZog9p4wqhoc6Dwvf8vjOfw9w+RcXucNj7e+0kpPa4wZmHDg1sHK5FAVCBXRgndb8XB2boj4TmBkgW9+AsLIOr/X6m/TX1uxjiyz3AOvjNQODMcVqb1GKrtrQ83qRQoCEf+SpITbeQJsSrLcnbhOR2zVZnBU0pXc46ghRAI+phMzGf3NnjRYBLOEPK8DzOxMheqcqFF5DIF+dyRZIYkhEgpJiNmn7wGIokhlLXWzNlEeHKvyTm4f4o+sWsdgNWHuUx2RHlG2KYDfniSaGyIUMMb4Zz/k+F5pGpyKp263x6v9VaBOztNyv40RmqGsG3o30+SMQZvXBAQsdb/UaJVTRdaVHZ2sPY22HzS9WuPDaLnbuqnHWySUe+vIU/uCjbcxRIUPpylKfeQMjuLTHF+drHH9sC2tWlxxGRKJiFADY/nKFXTsqjLUpE2jsx3Qq6C8A6CQEuP2V1wCNNfpmamvG/wg6amzLOmESPh+D0P7FVwMuuHoRW7dXOP19JW79zDjaLWBqQsLGipXo9jpZa2tTuG742EQmtKZSpcU/+VEf3fmANhVDbHnJGpEa8zUnxVK+o8N4fFx/H2F/MSXl3VvrBzhqUUmIJHdNedyAcfvrARdc08WzL9U4+bgSt181jjEFP1tljiVsrOHFAzothz27a5xx6jhOfn8HVUVU12YkvUR6/c/DPXQKEi4VPkyIuDrMiqNA3pbz/tGV29j3N68QetLweWuKKEOjdjMpsMX8Sb6nt2VLgCd/VuHMK4Z44ZUK7z26wJ1Xj2N6ynGKHOvYjhR6XumrKpFkbBfAnjcrrD2mhc9dORXpb5wJhULh8dzPB9j0wwEmlxDZMM9JyC9VoGQmz7wgU0Bc089dfqRCPKApqqsutCRGrarTf8PhjT0Bu2cDdu8L2LOvxu69AbP7A3a8UeEXWyu86zCPr187jjWHNFtclvqoFUZkiRRKf6/fDdj1eoXf/PUObrtlBstnpIVH1aB5IydBB3zr6wvodym/Sy9AKG8qi1NPgOixk7XBfJ0ub2o2lJBVdY2YsK6MFiWfO9/jnSuBHz1HHuGFSmuKC5XH6uUOHz+jhdUrndQChSiBXtTEoLRHQFj1a47bibbDrxxR4twzx7Bh/QTKlvCHKLzyf+oSbX66j0f/vYtlU1K/MAFSdyceEIVXAxdxeVy5fwPtRxHd9vw0GqBqIn4zWhpw4akeF5769gmDeADFr1mOXq/urHkN8Nyzx3DGKR20yoBDVhQ4+siSFUVWr014fZCUTue9bsCXrtsfOQIxWxNamiAKiOwZojxPHmBr75a/Y2hpP988pMEHYsfT1u0TEaFTyvMCS9m9htTWpIwlMMWuw8JizV3do99Z4PNXTnHLK9UXQemz4/rBhmW84naYw99fuw/PbR5g5XTBniwIT9bWuHcS+8YraAAfGyIZBlgGyHd45fv4UsTZW+rGmB7KghoVQkqK/J1XeEiIlLRJWRQ+DzzSx8+2DHHqB9osfK9Xs9DkKZRdpAucApDcXsb2uOX6WTz0r4tYQcIPc0HT59QBSpmgsBCILa98BSfb0jKa7jMAOEhTJOmGU2C85BCoINEvyT9IwHbL49WdFW68bZ6Xu9afPcZ3m+KUPFiASQiQkkuP/ftr3PS3s3j4/i73Aql+sc4vC6+rQIL2Qs+NY6QQqG0zZEZYLC2mYowfokVN1n6dGg/NV8YPzF1iBORlFK36BLS956XuP/3sPjy7ZYDL/2QJjv3VEr2+FDK8yKrZIa0byvS//0gPt39pDttfqHiVF4NEm2PDU0tgvpZ7AdMXMUZpW1Kb+4GaqY8+twpgx96A+x4PuPjDsmB54GukX3DQl1yfXwDuf7SHm766gJdfGeIPf38c11wxxd91aO/BQV673qjw1BMDPPhvi3j6yT7GSoeZZbKIa2UyNb3yJqitBebub6tPnosj22010rsf3exEgDNRAld9o8aPX3B412rdB2xgl1Hf0CiEMseoA3r9gG3bK/xw0wAvbB1iqkMkyeOw1QW+9s0FDAeCFeIwAYNewK5dNV7ZWmHb80O8uaNmUrR0Uqo6WgITmptITlRAg1LnZMiIEODec8MwkDV4707+A4isCHJD2cNr3GDfHLi/Z3v4448Xsj38EiepEOLqTru8RaDdHeDtLrZldn6/LnHbhLlNpwQmAB3vMNFxGOPtNZrmaqvzpbYXzm/ARyWvl4YIdYbU/Rn4CFMqYGq5ly0yVqUdUMnZ6q4Bl94zM2E9xGztTxc045aavK1Of1wxxQWiqDULYJuj6G/QEje7byAl6IT1YAF0H7HsKpUmjVV4eakcra6rwlIP6DJYtkbA6Ri8P0CB1jYv5u2lvBoULsfnnJpG9vCyIEqWZHeJrjJn48adGrzzSyZgGxek2ySeZqFjz3FjNd/vo0JKw8QEVgVqt0iKH1sDlBTKy+r6TLBx6nwFuPGefpMTc79Z3RRkPXw+H21njVSPcQ9fanXbWLymb/1/29RgkKmNTRuLBVXrxx0m+lkENmVY7S/zEWtrb9BWiRxlgZGCJ+a9PLHlfEDBTP2hsTFRdpVJNWdPx21qWVPDWtP5ik+j4Zn176wFzoWN9fcyoDNhI+dXppkA0XoCTQLEPCAIdhxk5Tur+nWPsChKYzxH97h/37aqm+z2Sw7ZvGRa5x5c3IuUlBBbVBYWBlymuEx4Gyuv74X4pDTXYILWD8ja4zRKYVR49Fcdxg3invt8yUsVJCRPHshrBWNZ+R49UYLt5tYfRcR6Xy0c3Ta5dJ6/Zd/vCNjlxCcueCa2l1pgGQDGzpIVSEPMyq6w5q+wzOoNUIzu0uz0SFhkHlHTiq4InO4zr9ENSjHO841N2e5ui3PrBTZQPFlagC0Jb54Vd4pZqNiOttgPoI4AZn1ZYLPzLoQatS2CNmod3T3W7Asc+Puc5D1JKRbpRJnFYgZAI9iQub7EvY9gxc9yW1vW+HgME3KkwSkNDs0EVnXqWqARIG3X1y3XDq0xbPbTS4q7vVcCN7qwGWM73/HV3P0t7iwImoOhlMZpe0rc8q7tblaE9vxzJaTCJa3nC/iZp6QFTgNGi/0mC9TvOTukUNLUG8Y6hZte7e/2l52Iu8ar6qXalR6hrhq5P0+LI7/DaYBgrHnMve1HEhYu6RkWgq2bvKDJ3cVGOfhZLOdYkaq8xPIYX2zVV72uyPBEN01XnTDuy2WLL33w+rG7/PpT3NyvrQ4bx9tww8qT1ejHNHFPQEJ6Ke0E1LJd2FmhR90g04xpP+tfKCjmYKaWIU/ImhcpTpXi2q7UfLeH9fXVqSVsTNiMD+Rh4uraDT2mlpXu8BNaG1etcnN+3T2huPcvWg8dubS6dHJJUfD6bFVXrq5rrw3+tCaXOuGmBENzAzHpu0tvL63uNj8bykdeoCkt8QHL+SqAkRxz60wJcQ9BFh6p7CX8CYEQLtShKocTfmbpRLHs3d1LT7u+9dA99tNZ+yHxBTcNztz0mr9x74I/hnZXhD7F/PCAn6bJz+U0vrPr7K5VJUJZf5/v040NDcG02LGGJVmfOsuxdifg03U9vUZHrPz0fl7p5caGjNkiEmTFUXBooUDbjWGs5TE+Pdyy6vjqijO+MPYACb+efjwdiYsqIewMk+d8tbro1b1uXXehPrYahmn+hZmGgtefqsalNFvU1BpAhM8QXhUlCmgCmihAUnBUQixk6J2eSYqwvM9Iz5sfrApM7LDF7W651oILbef3Tky0Nk2vcfeed0dxp3Nu7h6EYr2sgOL/Aa5OuMdnE5sWAAAAAElFTkSuQmCC";

    // ── GitHub 仓库（插件设置卡底部“鼓励一下”链接目标；同族插件
    //    dsh-sub-cli / dsh-subagent-default-model 的对齐项）──
    var LDVH_GITHUB_URL = "https://github.com/dingminhua/dsh-ldvh";

    // ── 卡头图标（16×16 描边线稿）────────────────────────────────────────
    //
    // 每组一块卡，卡头左端一枚图标。**图标不承载信息**：形状看不懂的人
    // 靠紧挨着的组名即可（故图标一律 aria-hidden，不进读屏播报）。
    // 描边用 currentColor，随主题走；不写死颜色（宿主换主题即失配）。
    var LDVH_BLOCK_ICONS = {
      // 浏览器窗口：服务与入口。
      services: [
        { t: "rect", p: { x: 1.8, y: 3, width: 12.4, height: 9.4, rx: 1.6 } },
        { t: "line", p: { x1: 1.8, y1: 6.2, x2: 14.2, y2: 6.2 } },
        { t: "line", p: { x1: 6.2, y1: 13.4, x2: 9.8, y2: 13.4 } }
      ],
      // 时钟：闲时派发。
      idle: [
        { t: "circle", p: { cx: 8, cy: 8, r: 5.7 } },
        { t: "path", p: { d: "M8 4.7V8l2.3 1.5" } }
      ],
      // 推子：召回预算（选档位）。
      budget: [
        { t: "line", p: { x1: 2.4, y1: 5.2, x2: 13.6, y2: 5.2 } },
        { t: "line", p: { x1: 2.4, y1: 10.8, x2: 13.6, y2: 10.8 } },
        { t: "circle", p: { cx: 5.6, cy: 5.2, r: 1.7 } },
        { t: "circle", p: { cx: 10.6, cy: 10.8, r: 1.7 } }
      ],
      // 盾与勾：把关询问。
      review: [
        { t: "path", p: { d: "M8 2.2l5 2v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V4.2z" } },
        { t: "path", p: { d: "M5.9 8.1l1.6 1.6 2.9-3.2" } }
      ],
      // 文件夹：管辖项目。
      projects: [
        { t: "path", p: { d: "M1.9 4.6a1 1 0 0 1 1-1h3.2l1.4 1.7h5.6a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1z" } }
      ]
    };

    var SETTINGS_CSS =       /* ── 页面骨架 ──────────────────────────────────────────────────────────
         设置页的正文列很窄：宿主面板 800px − 188px 导航列 − 2×24px 内容内衬
         ⇒ 实宽约 564px（宿主 dsh-client-ui-settings-general/SettingsRoot.module.css）。
         宿主自己的 General 区是扁平列（Feature-contributed rows own their chrome
         and separators），故本插件的分组卡片/分组导轨是**有意的偏离**。
         九轮之后定下的版面原则（下面逐条落地）：
           ① **颜色只表示状态**：蓝=生效中、绿=正常、红=出错；组图标与组名
              一律中性墨色，不拿颜色当装饰——一页 6 枚蓝开关 + 5 枚蓝图标时，
              蓝色就只是背景噪声，不再指向「开着」。
           ② **机器的值用等宽字**（档位、数值、计数、路径），人写的话用宿主
              正文字体。等宽是本页唯一新增的字体角色，用来区分「机器读的数」
              与「人写的说明」。
           ③ **旁注没有底色**：只有一根 1px 竖线 + 次级墨色，不再是灰底方块。
           ④ **圆角收敛**：卡面 12px → 6px，控件 10px → 6px，按钮 8px → 6px。
         本段（骨架段）是**版面结构规则**：换版面只改这一段，其余是共用的字阶、
         控件与注记形制。 */
      /* 线权重：组内一律用**发丝**（7%）并两侧各缩进 16px——缩进比粗细更能
         说明「这是组内的一条线」，因为线不再顶到卡片边缘，就不会读成表格。 */
      ".ldv-settings{--ldv-ink:var(--dsw-alias-label-primary,currentColor);--ldv-body:var(--dsw-alias-label-secondary,currentColor);--ldv-meta:var(--dsw-alias-label-tertiary,currentColor);--ldv-accent:var(--dsw-alias-state-business-primary,#4176e6);--ldv-silent:var(--dsw-alias-state-warning-primary,#f59e0b);--ldv-hair:color-mix(in srgb,var(--ldv-ink) 8%,transparent);display:flex;flex-direction:column;gap:16px;margin:0;padding:0 0 4px;color:var(--ldv-ink);container-type:inline-size;container-name:ldv-settings}" +
      /* ═══ 骨架段 START（版面结构规则集中于此；换版面只改这一段）═══ */
      /* 组 = **一块面**（2026-11-13 第三稿，Human 判导轨刻度「样式不行」后重做）。
         上一稿用左侧导轨 + 逐行刻度把行串起来，结果是整页读成一份文档：没有
         边界、没有归属、组与组之间只靠 34px 空白分开。这一稿把「组」交还给
         **面**：一组一块淡面（宿主的 module-platform：浅色 #f5f6f7／暗色
         #353638），12px 圆角、无边框、无投影——面本身就是分组，不需要再画线。
         这是对第九轮「去卡面」的**反向修正**，理由写在这里以免下次又翻回来：
         去卡面是为了甩掉当时那套「渐变 + 描边 + 投影 + 20px 圆角」的重样式；
         面本身没错，错的是那套装饰。现在只留一块最淡的底 + 一档圆角。 */
      ".ldv-block{position:relative;display:flex;flex-direction:column;min-width:0;padding:0;border:1px solid color-mix(in srgb,var(--ldv-ink) 7%,transparent);border-radius:12px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,currentColor 4%,transparent));box-shadow:none;overflow:hidden}" +
      /* 组名行：组的抬头。抬头与组身之间那道发丝**两侧缩进 16px**——卡片边缘
         已经是一条边界，再让线顶到边缘就成了双层框。 */
      ".ldv-block-head{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:15px 16px 13px;background:transparent}" +
      ".ldv-block-head:after{content:'';position:absolute;left:16px;right:16px;bottom:0;height:1px;background:var(--ldv-hair)}" +
      ".ldv-block-icon{display:grid;place-items:center;width:16px;height:16px;flex:none;color:var(--ldv-body)}" +
      ".ldv-block-icon svg{width:16px;height:16px;display:block}" +
      ".ldv-block-title-line{display:flex;align-items:center;gap:8px;min-width:0}" +
      /* 组名 15px/600：有面之后，字号不必再靠 16px 才能压住行名——面已经把
         「一组」说清楚了，字只管读。 */
      ".ldv-block-title{font-size:15px;font-weight:600;line-height:22px;letter-spacing:.01em;color:var(--ldv-ink)}" +
      /* 行：行与行之间一道**缩进发丝**（左 16 / 右 16），不顶边、不加粗。 */
      ".ldv-row{position:relative;display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-top:none}" +
      ".ldv-row:after{content:'';position:absolute;left:16px;right:16px;top:0;height:1px;background:var(--ldv-hair)}" +
      ".ldv-row:first-child:after{display:none}" +
      /* ═══ 骨架段 END ═══ */
      /* 组说明：描述**整组**，与行说明（.ldv-row-desc）分属两层，两者不混。
         它与行说明同字号（12px），靠**位置**分层：站在组名正下方、分组线之上，
         与第一行之间隔着那道分组线。 */
      ".ldv-block-desc{flex-basis:100%;margin-top:8px;font-size:12px;font-weight:400;line-height:20px;color:var(--ldv-body);text-wrap:pretty}" +
      /* 卡头里的控件分**两个槽位**（2026-11-13 Human 定）：
         状态读数（药丸）贴组名——它是这一组的状态，离开组名就没有主语；
         总开关推回行末——按宿主的通行做法放在行末，扫视整页时所有开关
         落在同一条竖线上。 */
      ".ldv-block-control{flex:none;display:flex;align-items:center;gap:8px}" +
      ".ldv-block-toggle{margin-left:auto}" +
      ".ldv-block-action{margin-left:auto}" +
      ".ldv-block-body{display:flex;flex-direction:column}" +
      /* 行内：**标题与控件相邻**成一行（同一条基线上），控件**推到最右侧**，
         说明另起一行占满整列。
         2026-11-13 Human 指示：「所有的选择和操作都是放在最右侧对齐」——
         全页的开关/输入框/下拉/复选框落在同一条竖线上，扫视时一眼能数出
         有几项、各是什么状态。此前控件紧贴标题（`gap` 之后的自然位置），
         右侧留出一片空白，与宿主其他面板的通行做法不一致。
         **为何仍与标题同处一行**：控件若被说明段落竖直居中（旧版左文右控
         的做法），它会落在段落中部，归属全靠猜；现在它与标题同在行头的
         基线上、贴着标题右侧，归属仍然确定，而右缘对齐由「行头两端分布」
         给出。说明独占一行的结构不变，故「说明与控件不同层」这条不变量
         仍成立。 */
      ".ldv-row-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}" +
      ".ldv-row-title{min-width:0;font-size:14px;font-weight:500;line-height:21px;color:var(--ldv-ink)}" +
      ".ldv-row-desc{font-size:12px;font-weight:400;line-height:20px;color:var(--ldv-body);text-wrap:pretty}" +
      /* 说明里的 **强调**：词条按 Markdown 写的 **…**，在设置页是纯文本，
         直接印出来会露出星号。渲染时转成真正的强调（不改动词条本身）。 */
      ".ldv-row-desc strong{font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-row-control{flex:none;display:flex;align-items:center}" +
      /* 注记（旁注）：组内的**附注**，排在最后一行之后，同样是 16px 内衬。
         与行区分靠两处：上缘一道**虚线**（实线在组内一律表示「又一项」），
         以及没有标题时的纯次墨小字。此前它是「灰底方块 + 竖线」，随后改成
         一根 1px 竖线（与导轨并排成两条长度不一的线，像没对齐的缩进），再
         改成整幅上缘虚线——现在它就在卡里，什么底都不需要，只留那道虚线。 */
      ".ldv-note{position:relative;display:flex;flex-direction:column;gap:2px;margin:0;padding:13px 16px 15px}" +
      ".ldv-note:before{content:'';position:absolute;left:16px;right:16px;top:0;height:1px;background-image:repeating-linear-gradient(90deg,color-mix(in srgb,var(--ldv-ink) 13%,transparent) 0 4px,transparent 4px 9px)}" +
      ".ldv-note-title{font-size:12px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-note-text{font-size:12px;font-weight:400;line-height:19px;color:var(--dsw-alias-label-secondary,currentColor);text-wrap:pretty}" +
      /* 计数徽标：机器读数 → 等宽。 */
      ".ldv-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600;line-height:16px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary,currentColor) 16%,transparent);color:var(--dsw-alias-label-secondary,currentColor)}" +
      /* 状态读数：卡头上的一枚药丸（结论自带色与圆点，不必靠文字颜色硬读）。 */
      ".ldv-status-value{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;line-height:16px;flex:none;padding:1px 9px;border-radius:999px;background:color-mix(in srgb,currentColor 12%,transparent)}" +
      ".ldv-status-value:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}" +
      ".ldv-status-ok{color:var(--dsw-alias-state-success-primary,#34d399)}" +
      ".ldv-status-fail{color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-status-wait{color:var(--dsw-alias-label-tertiary,currentColor)}" +
      /* 输入框与下拉：取宿主「选择器药丸」的形制（32px 高、圆角、module-platform 底）。
         **值用等宽字**——这是本页唯一新增的字体角色，用来把「机器读出来的数」
         与「人写的字」分开（档位 10 K、安静时长 5、计数 1）。
         高度 34→32（2026-11-13 第二轮）：34px 的框压在 21px 的行头上，上下各
         多出半行，读者先看见框、后看见标题；32px 与标题同处一条基线，不再抢戏。 */
      ".ldv-settings-input{box-sizing:border-box;appearance:none;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));border-radius:6px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--ldv-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-variant-numeric:tabular-nums;line-height:1.5}" +
      ".ldv-field-input{width:82px;flex:none}" +
      ".ldv-field-select{width:96px;flex:none;padding-right:24px}" +
      /* 下拉的展开箭头：宿主原生箭头在 appearance:none 下会消失，
         档位框看上去与输入框无异（读者不知道那是一个下拉）。自绘一枚
         折角，随主题走（用 label-secondary 的 currentColor 描边）。 */
      ".ldv-select{position:relative;display:inline-flex;align-items:center}" +
      ".ldv-select:after{content:'';position:absolute;right:9px;top:50%;width:6px;height:6px;margin-top:-4px;border-right:1px solid var(--dsw-alias-label-secondary,currentColor);border-bottom:1px solid var(--dsw-alias-label-secondary,currentColor);transform:rotate(45deg);pointer-events:none}" +
      ".ldv-field-invalid{font-size:11px;font-weight:400;line-height:16px;color:var(--dsw-alias-state-error-primary,#f56c6c)}" +
      ".ldv-settings-input.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 60%,transparent)}" +
      ".ldv-settings-input[aria-invalid='true']{border-color:var(--dsw-alias-state-error-primary,#f56c6c)}" +
      ".ldv-settings-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.22)}" +
      ".ldv-settings-input.is-error:focus-visible{border-color:var(--dsw-alias-state-error-primary,#f56c6c);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 22%,transparent)}" +
      /* 开关：全页只用它，不再与原生复选框混用。
         **轨道用业务蓝、钮用白**（2026-11-13 Human 定）：宿主浅色主题的
         brand-primary 是近黑 #0f1115，于是「黑轨白钮」既重又黑白分明——
         在一页淡色卡片上像一枚实心黑块。故改取 state-business-primary
         （浅 #4176e6 / 暗 #7aaaff）作轨色，钮取 label-on-color（两套主题
         都是纯白 #ffffff）。**未开启**态仍走中性灰（border-l3 轨 +
         switch-thumb 钮），免得整页都是蓝点。
         蓝色因此只剩一个含义：**这一项开着**。 */
      ".ldv-switch{position:relative;display:inline-block;width:36px;height:20px;flex:none;cursor:pointer}" +
      ".ldv-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}" +
      ".ldv-switch-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l3,#ffffff29);transition:background .12s ease}" +
      ".ldv-switch-track:after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb,currentColor);transition:transform .12s ease}" +
      ".ldv-switch input:checked+.ldv-switch-track{background:var(--ldv-accent)}" +
      ".ldv-switch input:checked+.ldv-switch-track:after{background:var(--dsw-alias-label-on-color,#ffffff);transform:translateX(16px)}" +
      ".ldv-switch input:focus-visible+.ldv-switch-track{outline:2px solid var(--ldv-accent);outline-offset:2px}" +
      ".ldv-switch input:disabled+.ldv-switch-track{opacity:.5;cursor:not-allowed}" +
      /* 静默执行开关：**琥珀轨**（2026-11-13 晚 Human 要求「需要用不一样的颜色」）。
         `--ldv-silent` 是浅色主题的琥珀；暗色主题取宿主 state-warning 一类的
         暖色，取不到时仍落回琥珀本身——宁可两套主题同色，也不要落回蓝色
         （那会让「静默」与「又多一处把关」不可区分，正是要避免的误读）。
         **它不改 .ldv-switch 的默认规则**：只有挂 .ldv-switch-silent 的那一枚
         走琥珀，其余所有开关仍是蓝＝开着。 */
      ".ldv-silent-control{display:inline-flex;align-items:center;gap:8px;flex:none}" +
      ".ldv-silent-badge{font-size:11px;font-weight:600;line-height:16px;padding:1px 7px;border-radius:999px;color:color-mix(in srgb,var(--ldv-silent) 55%,var(--ldv-ink));background:color-mix(in srgb,var(--ldv-silent) 16%,transparent);white-space:nowrap}" +
      ".ldv-switch-silent input:checked+.ldv-switch-track{background:var(--ldv-silent)}" +
      ".ldv-switch-silent input:checked+.ldv-switch-track:after{background:var(--dsw-alias-label-on-color,#ffffff)}" +
      ".ldv-switch-silent input:focus-visible+.ldv-switch-track{outline-color:var(--ldv-silent)}" +
      /* 管辖项目：组内的一层**凸起小面**——组身是淡面，小面回到 bg-layer-2
         （浅色＝白、暗色＝比组身更深一档），于是「组 > 条目」两级成立。
         此前小面取 module-platform，与现在的组身同色，会整块消失。 */
      ".ldv-governance-add{display:flex;flex-direction:column;gap:13px;margin:14px 16px;padding:14px;border:1px solid var(--ldv-hair);border-radius:10px;background:var(--dsw-alias-bg-layer-2,transparent)}" +
      ".ldv-governance-add-head{display:flex;align-items:flex-start;gap:9px}" +
      /* 「＋」标记：此前是蓝底白字的实心方块（页面里第二块彩色块）。改为
         中性描边方框——加号是动作，不需要品牌色。 */
      ".ldv-governance-add-icon{display:grid;place-items:center;width:22px;height:22px;flex:none;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));border-radius:5px;color:var(--dsw-alias-label-secondary,currentColor);font-size:14px;font-weight:400;line-height:1;background:transparent}" +
      ".ldv-governance-add-copy{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".ldv-governance-add-title{font-size:13px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-governance-add-hint{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-governance-add-fields{display:flex;flex-direction:column;gap:13px}" +
      ".ldv-governance-add-field{display:flex;flex-direction:column;gap:6px;min-width:0}" +
      ".ldv-governance-add-label{font-size:12px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-governance-add-field-help{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-governance-add-field-error{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-governance-path-control{display:flex;min-width:0}" +
      ".ldv-governance-path-control .ldv-settings-input{flex:1;min-width:0;border-radius:6px 0 0 6px}" +
      ".ldv-governance-path-control .ldv-btn{height:32px;flex:none;border-left:0;border-radius:0 6px 6px 0;white-space:nowrap}" +
      ".ldv-governance-add-actions{display:flex;justify-content:flex-end;gap:8px}" +
      ".ldv-governance-add-actions .ldv-btn{min-width:76px}" +
      ".ldv-governance-add-error{padding:8px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 35%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444);word-break:break-word}" +
      ".ldv-governance-empty{display:flex;flex-direction:column;align-items:center;gap:6px;margin:0;padding:22px 16px;text-align:center}" +
      ".ldv-governance-empty-icon{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;border:1px dashed var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));color:var(--dsw-alias-label-tertiary,currentColor);font-size:16px;font-weight:600}" +
      ".ldv-governance-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-governance-empty-text{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-governance-error{margin:0 16px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 45%,transparent);border-left:3px solid var(--dsw-alias-state-error-primary,#ef4444);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-primary,currentColor);word-break:break-word}" +
      ".ldv-projects{display:flex;flex-direction:column;gap:8px;padding:14px 16px}" +
      /* 项目条目：组内的一层小面（bg-layer-2 + 发丝边），与组身拉开一级。 */
      ".ldv-project-card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--ldv-hair);border-radius:10px;background:var(--dsw-alias-bg-layer-2,transparent)}" +
      ".ldv-project-head{display:flex;align-items:flex-start;gap:12px}" +
      ".ldv-project-idline{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-width:0}" +
      ".ldv-project-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-project-path{flex-basis:100%;font-size:12px;font-weight:400;line-height:18px;word-break:break-all;color:var(--dsw-alias-label-tertiary,currentColor);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}" +
      ".ldv-project-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}" +
      /* 项目色板：色点 + 「自动取色」。这是卡片内的一个小控件，
         仍用原生复选框（与色点同组），故 .ldv-check 一组样式在此保留。
         2026-11-13 第三稿：色点 18→16px、间距 10→8px、未选中降到 72% 不透明
         ——十枚饱和色圆点是全页最响的一块，而它们只是**可选的颜色**，不是
         状态；压到「一排安静的样本、选中那枚才亮」之后，蓝色仍只表示开着。 */
      ".ldv-palette{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--ldv-hair)}" +
      ".ldv-palette-label{font-size:12px;font-weight:400;color:var(--ldv-meta);flex:none;margin-right:2px}" +
      ".ldv-palette-dot{position:relative;width:16px;height:16px;border-radius:50%;border:none;padding:0;cursor:pointer;flex:none;opacity:.72;transition:transform .12s,opacity .12s}" +
      ".ldv-palette-dot:hover,.ldv-palette-dot:focus-visible{transform:scale(1.12);opacity:1}" +
      ".ldv-palette-dot:disabled{cursor:not-allowed;opacity:.4}" +
      ".ldv-palette-dot-active{opacity:1;box-shadow:0 0 0 2px var(--dsw-alias-bg-module-platform,#f5f6f7),0 0 0 3.5px color-mix(in srgb,var(--ldv-ink) 38%,transparent)}" +
      ".ldv-palette-check{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.55);pointer-events:none}" +
      ".ldv-palette-dot-locked{opacity:.25}" +
      ".ldv-palette-dot-locked:hover{transform:none}" +
      ".ldv-palette-auto{flex:none;margin-left:auto}" +
      /* 「自动取色」的复选框：此前是**原生**方框——浅色主题下与页面无异，
         暗色主题下却是一只刺眼的白方块（accent-color 只管勾选后的颜色，
         未勾选时由浏览器原生外观决定）。改为自绘：14px 方框、圆角 3、
         勾选时取业务蓝 + 白色对勾、焦点有可见环。原生 input 保留在框里
         （透明覆盖），键盘与读屏行为不变。 */
      ".ldv-check{position:relative;display:inline-flex;align-items:center;gap:0;min-height:20px;padding-left:21px;cursor:pointer}" +
      ".ldv-check input{position:absolute;left:0;top:50%;margin:-7px 0 0;width:14px;height:14px;opacity:0;cursor:pointer}" +
      ".ldv-check:before{content:'';position:absolute;left:0;top:50%;margin-top:-7px;width:14px;height:14px;border:1px solid var(--dsw-alias-border-l3,color-mix(in srgb,currentColor 12%,transparent));border-radius:3px;background:transparent}" +
      ".ldv-check:has(input:checked):before{background:var(--dsw-alias-state-business-primary,#5686fe);border-color:var(--dsw-alias-state-business-primary,#5686fe)}" +
      ".ldv-check:has(input:checked):after{content:'';position:absolute;left:4px;top:50%;margin-top:-4px;width:4px;height:8px;border-right:1.5px solid var(--dsw-alias-label-on-color,#ffffff);border-bottom:1.5px solid var(--dsw-alias-label-on-color,#ffffff);transform:rotate(45deg)}" +
      ".ldv-check:has(input:focus-visible):before{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:2px}" +
      ".ldv-check-label{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor);user-select:none}" +
      ".ldv-palette-auto-on .ldv-check-label{color:var(--dsw-alias-state-business-primary,#5686fe);font-weight:600}" +
      /* 提示行（次要说明）。组身已无内衬，直接挂在组身里的提示自己补 16px。 */
      ".ldv-settings-hint{font-size:12px;font-weight:400;line-height:18px;color:var(--ldv-body)}" +
      ".ldv-block-body>.ldv-settings-hint{display:block;padding:12px 16px 0}" +
      ".ldv-settings-hint strong{font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}" +
      /* 按钮：与宿主同族的方钮（圆角 6、13px）。「有未保存改动」时另有
         **不依赖颜色**的形状变化（字重 + 描边），色觉障碍下同样可辨。 */
      ".ldv-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:6px 13px;font-size:13px;font-weight:500;line-height:1.5;transition:opacity .16s,border-color .16s}" +
      ".ldv-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}" +
      ".ldv-btn-primary{background:var(--dsw-alias-label-primary,currentColor);color:var(--dsw-alias-bg-layer-3,#202126)}" +
      ".ldv-btn-outline{border-color:var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));color:var(--dsw-alias-label-secondary,currentColor);background:transparent}" +
      ".ldv-btn-primary:hover:not(:disabled){opacity:.9}" +
      ".ldv-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary,currentColor);border-color:var(--dsw-alias-label-dimmed,#777);background:rgba(255,255,255,.04)}" +
      ".ldv-btn:disabled{opacity:.4;cursor:default}" +
      ".ldv-btn-dirty{font-weight:600;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 45%,transparent)}" +
      /* 页脚：左「鼓励一下 ★」+ 保存状态，右「放弃修改 / 保存」。
         页脚上方加一道发丝线：它与上面的设置项是两类东西（一个是事实，
         一个是动作），不该连成一片。 */
      ".ldv-settings-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;padding:16px 0 4px;border-top:1px solid var(--ldv-hair)}" +
      ".ldv-settings-footer-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}" +
      ".ldv-settings-footer-status{flex:1;min-width:0;font-size:12px;font-weight:400;line-height:1.5;color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-settings-footer-error{flex:1;min-width:0;font-size:12px;font-weight:400;line-height:1.5;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-settings-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,currentColor);font-size:13px;line-height:1.5;transition:color .16s}" +
      ".ldv-settings-cheer-star{font-size:12px;line-height:1;display:inline-flex}" +
      ".ldv-settings-cheer:hover{color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-settings-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}" +
      /* 窄列：**按内容列宽**降级（宿主在 macOS/Windows 原生标题栏下窄视口
         仍保留 188px 导航列，视口宽与内容列宽会脱钩，故用容器查询）。
         <420px：导轨内衬与行距收窄；<300px：控件可换行到标题下方，
         数值框宽度放开到 160px。 */
      "@container ldv-settings (max-width:420px){.ldv-block{border-radius:10px}.ldv-block-head{padding:14px 14px 12px}.ldv-block-head:after{left:14px;right:14px}.ldv-row{padding:13px 14px}.ldv-row:after{left:14px;right:14px}.ldv-note{padding:12px 14px 14px}.ldv-note:before{left:14px;right:14px}.ldv-projects{padding:12px 14px}.ldv-governance-add{margin:12px 14px}.ldv-block-head,.ldv-row{gap:8px}.ldv-governance-path-control{display:grid;gap:8px}.ldv-governance-path-control .ldv-settings-input{border-radius:6px}.ldv-governance-path-control .ldv-btn{border-left:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));border-radius:6px}.ldv-governance-add-actions,.ldv-project-actions{justify-content:stretch}.ldv-governance-add-actions .ldv-btn,.ldv-project-actions .ldv-btn{flex:1;min-width:0}}" +
      "@container ldv-settings (max-width:300px){.ldv-row-head{flex-wrap:wrap}.ldv-field-input,.ldv-field-select{width:160px}}" +
      /* 侧栏 / 对话 Tab 里的 iframe 面（与设置页无关，但同属本插件的样式卡）。 */
      ".ldv-view{position:relative;width:100%;height:100%;min-height:0}" +
      ".ldv-view-frame{position:absolute;inset:0;width:100%;height:100%;border:0}" +
      ".ldv-view-state{position:absolute;inset:0;display:grid;place-items:center;gap:10px;align-content:center;text-align:center;padding:24px}" +
      ".ldv-view-state p{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,currentColor);margin:0;max-width:520px}" +
      "";
;

    // ── 宿主提问卡（Human Gate 落点）观感覆写 ────────────────────────────
    // 本插件的受控写入一律经 `ctx.userQuestions.ask` 提请 Human 决定，答复面
    // 就是宿主的提问卡（宿主包 ui-user-questions 的 QuestionComposer）。该卡
    // 原样把「问题」与「备选项」压成同一种灰度行，Gate 上最该看清的「选哪个、
    // 选了会发生什么」反而最不显眼。这里只改观感：选项成卡片、选中态有强调色、
    // 正文与选项分层、页脚有分隔——**不改行为、不改 DOM、不接管答复通道**。
    //
    // 选择器口径（为什么不用类名）：宿主 CSS module 打包后的类名带构建期哈希
    // （实测形态 `22xwLW_frame`），哈希随宿主版本变、局部名不大会变，故用
    // `[class*="eyebrow"]` 这类**子串**命中局部名——刻意**不带下划线**：哈希与
    // 局部名之间的 `_` 只在未打包的 dev 构建里位置固定，写进选择器就等于把
    // 覆写绑死在构建形态上。`data-question-key` /
    // `data-question-scroll` 是组件自己挂的契约属性，比类名稳，因此全部规则以
    // `[data-question-key]` 为根——顺带把特异性抬到宿主单类规则之上，**全篇零
    // `!important`**（唯一例外是 reduced-motion 的撤销，见末尾）。子树一律用
    // 后代组合器而非 `>`：宿主升级多包一层容器不该让整张卡静默失焦。
    //
    // 作用域边界（如实声明）：这段 CSS 覆写的是**宿主全局**的提问卡，不只本
    // 插件发起的 Gate——宿主没有「按提问方」区分的钩子可锚。颜色全部走
    // `--dsw-alias-*` token（强调色底用 `color-mix`），浅/深主题自动跟随；
    // 宿主组件未装载时选择器命中为空，不产生任何副作用。
    var GATE_CSS = "" +
      /* 卡片外壳：原本只有 elevation-panel 那层极淡投影，浅底上几乎不成立
         （截图里像一块没有边界的白板）→ 补 stroke 描边 + 一层稍实的投影。 */
      "[data-question-key]{display:flex;justify-content:center;padding:10px calc(var(--dsh-composer-side-clearance,16px) + 16px) 14px}" +
      "[data-question-key] section{border-radius:var(--dsw-radius-panel,28px);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-stroke,0 0 0 .5px var(--dsw-alias-border-l2)),var(--dsw-elevation-panel,0 3px 8px rgba(0,0,0,.03)),0 12px 32px rgba(0,0,0,.08);overflow:hidden}" +
      /* 折叠态只剩标题行：高度上限与内滚动位都要撤掉，否则留一段空 body。 */
      "[data-question-key] section[class*=\"cardMinimized\"]{max-height:none;overflow:visible}" +
      /* eyebrow 原样是 11px 裸灰字，读起来像被截断的正文 → 收成小标签。 */
      "[data-question-key] header{padding:18px 14px 0 20px}" +
      "[data-question-key] [class*=\"eyebrow\"]{display:inline-flex;align-items:center;height:22px;padding:0 9px;margin-bottom:8px;border-radius:999px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;letter-spacing:.02em;line-height:16px}" +
      "[data-question-key] h2{font-size:16px;font-weight:600;letter-spacing:-.01em;line-height:24px}" +
      /* 内滚动位：只补左右内衬，让正文与选项的缩进和标题对齐。高度上限**沿用
          宿主的 min(60vh,520px)**——卡片是 flex 列、body 靠 flex 收缩到卡片余量，
          改它没有收益，只有「内容超出卡片被 overflow:hidden 裁掉却已无滚动位」
          的风险（宿主注释里「行不能被压缩、溢出归 .options」同源教训）。 */
      "[data-question-key] [data-question-scroll]{padding:2px 8px 0;overscroll-behavior:contain}" +
      "[data-question-key] [class*=\"options\"]{gap:0;margin:10px 0 0;padding:0 12px}" +
      /* 正文（detail）与选项同灰度同字号，糊成一坨 → 收成引用块。 */
      "[data-question-key] [class*=\"detail\"]{margin:10px 12px 2px;padding:10px 12px;border-left:2px solid var(--dsw-alias-border-l4);border-radius:0 var(--dsw-radius-sm,8px) var(--dsw-radius-sm,8px) 0;background:color-mix(in srgb,var(--dsw-alias-bg-module-platform) 55%,transparent);font-size:13px;line-height:21px}" +
      /* 选项：1px 间隙 + 透明边框 = 两行没有边界的灰字 → 可点卡片。
         **0.2.2-rc.1 起选项是两层**：外层 `div[data-option-row]`（宿主自己的
         `.optionRow`：0.5px 透明边、圆角、hover 底），内层 `button.option`
         才是 `[role=radio]` / `[role=checkbox]`。旧的单层写法（role 直接在
         按钮上）已不存在，故卡片外观必须挂到**外层行**，内层按钮退成纯内容
         （否则出现双边框、悬停高亮只覆盖内框、选中态画在行内）。 */
      "[data-question-key] [data-option-row]{position:relative;box-sizing:border-box;min-height:48px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:color-mix(in srgb,var(--dsw-alias-bg-module-platform) 45%,transparent);transition:background-color .14s ease,border-color .14s ease,box-shadow .14s ease,transform .14s ease}" +
      "[data-question-key] [data-option-row]+[data-option-row]{margin-top:6px}" +
      /* 内层按钮只留内容盒：撤掉宿主自己的边框/底色，避免双框。 */
      "[data-question-key] [data-option-row] [role=\"radio\"],[data-question-key] [data-option-row] [role=\"checkbox\"]{position:relative;box-sizing:border-box;min-height:0;padding:10px 12px;border:0;background:transparent;box-shadow:none;text-align:left;cursor:pointer}" +
      "[data-question-key] [data-option-row]:hover:not(:has([role=\"radio\"]:disabled)):not(:has([role=\"checkbox\"]:disabled)){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4);transform:translateY(-.5px)}" +
      "[data-question-key] [data-option-row]:active:not(:has([role=\"radio\"]:disabled)):not(:has([role=\"checkbox\"]:disabled)){transform:translateY(0)}" +
      /* 选中态：强调色描边 + 淡底 + 外圈光晕，序号块反白——一眼看出选的是哪项。 */
      "[data-question-key] [data-option-row][class*=\"optionSelected\"]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent)}" +
      "[data-question-key] [role=\"radio\"]:focus-visible,[data-question-key] [role=\"checkbox\"]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}" +
      "[data-question-key] [data-option-row]:has([role=\"radio\"]:disabled),[data-question-key] [data-option-row]:has([role=\"checkbox\"]:disabled){cursor:default;opacity:.55;transform:none}" +
      /* 序号块：20px 方角灰底 → 18px 圆片，选中时取强调色。 */
      "[data-question-key] [class*=\"number\"]{width:18px;flex:0 0 18px;height:18px;margin-top:3px;border:1px solid var(--dsw-alias-border-l4);border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:16px;transition:background-color .14s ease,border-color .14s ease,color .14s ease}" +
      "[data-question-key] [aria-checked=\"true\"] [class*=\"number\"]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}" +
      /* 多选方框与序号不同形，统一语言：同尺寸，选中取强调色填充。 */
      "[data-question-key] [class*=\"checkbox\"]{width:18px;flex:0 0 18px;height:18px;margin-top:3px}" +
      "[data-question-key] [class*=\"checkbox\"]::before{width:18px;height:18px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-xs,4px)}" +
      "[data-question-key] [class*=\"checkbox\"][class*=\"checkboxChecked\"]{color:var(--dsw-alias-label-primary-foreground)}" +
      "[data-question-key] [class*=\"checkbox\"][class*=\"checkboxChecked\"]::before{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary)}" +
      /* 备选项文案：label 与 description 原样同为 14px，主次不分。
         **排除 `descriptionToggle`**：宿主 0.2.2-rc.1 新增的「展开说明」按钮类名
         含 `description` 子串，不排除会把按钮当正文排版（字号/行高串到图标按钮上）。 */
      "[data-question-key] [class*=\"optionLabel\"]{font-size:14px;font-weight:600;line-height:22px}" +
      "[data-question-key] [class*=\"description\"]:not([class*=\"descriptionToggle\"]){font-size:13px;line-height:20px}" +
      /* 自由作答行：与选项同形，虚线边区分「这不是一个选项」。 */
      "[data-question-key] [class*=\"customRow\"]{box-sizing:border-box;min-height:48px;margin-top:6px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:transparent;transition:background-color .14s ease,border-color .14s ease}" +
      "[data-question-key] [class*=\"customRow\"]:hover,[data-question-key] [class*=\"customRow\"]:focus-within,[data-question-key] [class*=\"customRow\"][class*=\"customRowActive\"]{border-style:solid;border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}" +
      "[data-question-key] [class*=\"customBlock\"]{border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px)}" +
      "[data-question-key] [class*=\"customBlock\"]:focus-within{border-style:solid;border-color:var(--dsw-alias-state-business-primary)}" +
      /* 页脚：与内容之间没有分隔，按钮像浮在卡底 → 补 hairline；主按钮取品牌填充。 */
      "[data-question-key] footer{margin-top:12px;padding:10px 14px 12px 20px;border-top:1px solid var(--dsw-alias-border-l2)}" +
      "[data-question-key] footer [class*=\"footerActions\"]>button:last-child{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}" +
      "[data-question-key] footer [class*=\"footerActions\"]>button:last-child:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}" +
      /* 单题时 ‹ 1/1 › 是纯噪声：没有可翻的东西，却像个计数器。判据取「左右
         两个箭头同时 disabled」——宿主只在「当前即第一题且即末题」时如此。
         用 visibility 不用 display：页脚是 space-between，抽掉整组会让右侧
         按钮在提交那一刻（busy 时箭头也全禁用）横向抖一下，留占位就不动。 */
      "[data-question-key] footer [class*=\"pager\"]:has(> button:disabled + [class*=\"progress\"] + button:disabled){visibility:hidden}" +
      "@media (max-width:720px){" +
      "[data-question-key] header{padding:14px 10px 0 14px}" +
      "[data-question-key] [data-question-scroll]{padding:2px 4px 0}" +
      "[data-question-key] footer{padding:10px 10px 12px 14px}" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      "[data-question-key],[data-question-key] *{transition:none!important;transform:none!important}" +
      "}";
    if (typeof document !== "undefined") {
      // 两张 style 卡分开装：本插件自有面（.ldv-*）与宿主观感覆写混在一张里，
      // 出问题时无法单独摘除；宿主升级后想停用覆写也只能改代码。
      var cssSheets = [["dsh-ldvh/client.css", SETTINGS_CSS], ["dsh-ldvh/gate.css", GATE_CSS]];
      for (var cssSheetIndex = 0; cssSheetIndex < cssSheets.length; cssSheetIndex++) {
        var cssId = cssSheets[cssSheetIndex][0];
        if (document.querySelector("style[data-plugin-css='" + cssId + "']")) continue;
        var styleTag = document.createElement("style");
        styleTag.dataset.plugin = "dsh-ldvh";
        styleTag.dataset.pluginCss = cssId;
        styleTag.textContent = cssSheets[cssSheetIndex][1];
        document.head.appendChild(styleTag);
      }
    }

    // ── locale ───────────────────────────────────────────────────────────
    var LDVH_NS = "settings.ldvh";
    // 本插件声明的 Loader 条目 id（cordis.patch.yml 的 insert id）。0.1.7 起
    // 设置表单按【宿主服务的】条目 id 寻址：ctx.configForms.get(<entry id>)，
    // 宿主对 served-namespace 目录做**精确匹配**。声明值只是兜底——桌面宿主
    // 实际以 `include:dsh-ldvh` 挂载（dsh-connect-workbuddy 2.0.16 同款坑：
    // 硬编码短名会让设置卡绑定到无人服务的命名空间，status: unavailable 静默
    // 失效、不报错）。真实 id 由 ldvhEntryIdOf() 从 mirror 服务目录探测。
    var LDVH_ENTRY_ID = "dsh-ldvh";
    /**
     * 设置页（Settings 面板左侧导航）里本节目的 id —— **本插件自己拥有的**，
     * 不是宿主的 Loader 条目 id。
     *
     * ## 为什么另开一节（Human 2026-11-13）
     *
     * 此前 LDVH 的设置只挂在 **Plugins 页**的两个 keyed 槽位
     * （`plugins.bundle.config` / `plugins.row.config`）。那是「按包名精确匹配
     * 宿主清单」的寻址方式：同一个插件若被以不同 Loader 条目 id 挂载，两种拼写
     * 都得注册，漏一种就**整页不渲染且不报错**（dsh-connect-workbuddy 的 issue #55
     * 就是这个坑）。Human 的诉求很直接：「把 ldvh 的设置也放到设置里，参考
     * workbuddy 的做法」——即跟其它所有偏好放在一处，而不是埋在插件详情里。
     *
     * `settings.section` 是**列表槽位**，key 是本插件自有的 id：没有清单名要匹配，
     * 那一整类寻址失配从此不存在。id 同时也是图标的地址（宿主按
     * `{ only: row.id }` 渲染 `settings.section.icon`），故两个注册共用同一个常量。
     */
    var LDVH_SETTINGS_SECTION_ID = "dsh-ldvh";
    /**
     * 设置页导航位置。已发布的节位次：账号 -10、通用 0、模型 10、插件 15、
     * Agent 预设 20；实测第三方页面占 20（opencode-go）、30
     * （subagent-default-model）、35（workbuddy）、40（插件市场）、45
     * （archive-manager）、100（better-sidebar）。
     *
     * 取 **50**：排在插件市场之后、侧边卡片之前——LDVH 是治理层，不像连接器
     * 那样与账号/模型同层，也不抢占别人的 35。**不与任何内置或已装插件位置冲突**
     * 是本值唯一的硬约束（冲突时宿主渲染次序不稳定，两节都还在但顺序会跳）。
     */
    var LDVH_SETTINGS_SECTION_ORDER = 50;

    // 探测宿主实际服务的命名空间（dsh-connect-workbuddy 2.0.16 同款范式）：
    // configForms.get() 与 mirror 的 served-namespace 目录按**精确匹配**对表，
    // 猜错名字会让设置卡绑定到无人服务的命名空间（静默 unavailable）。先从
    // forms.describe() 的服务目录里找「等于声明 id、或含包名」的条目取它的
    // ns；mirror 未就绪（view 未填充 / describe 缺失）时回落到声明常量。
    function ldvhEntryIdOf(forms) {
      try {
        var view = forms.describe().getSnapshot().view;
        var namespaces = (view && view.namespaces) || [];
        var served = namespaces.find(function (entry) {
          return entry.ns === LDVH_ENTRY_ID || /ldvh/i.test(entry.ns || "");
        });
        if (served !== undefined && typeof served.ns === "string" && served.ns !== "") return served.ns;
      } catch (error) { /* mirror 未就绪：声明 id 仍正确 */ }
      return LDVH_ENTRY_ID;
    }
    var LDVH_ZH = {
      // 导航标签：设置页左侧那一行只显示这个。**必须短**——宿主的导航列宽度有限，
      // 长名字会被截成「LD Vibe Harness...」（Human 2026-11-13 实测截图）。
      // 取品牌缩写 LDVH：它已是本仓自己的用语（引导、文档、类型名都在用），
      // 不必再拼全称；全称留给需要完整标识的地方（`row.desc`、README）。
      "row.title": "LDVH",
      "row.governanceLocation": "管辖项目配置",
      "row.governanceLocationHint": "由 LDVH 自动保存在 DSH 用户配置目录下的 ldvh/governed-projects.yaml。",
      "row.projectsPanelTitle": "管辖项目",
      // ── 组名（卡片头）──────────────────────────────────────────────────
      // 2026-11-13 起本页按分组卡片组织，卡头要有一个**组名**——它回答的是
      // 「这一组管什么」，与组内各行的标题（「这一项是什么」）不同层，故另立
      // group.* 词条，不复用 row.*。
      "group.services": "服务与入口",
      "group.idle": "闲时派发",
      "group.budget": "召回预算",
      "row.addProject": "新增管辖项目",
      "row.addProjectTitle": "新增管辖项目",
      "row.addProjectHint": "选择或手动输入一个 Git 仓库根目录（绝对路径），安装会同时完成登记、初始化 ldvh-base/ 并安装 Git Hook。",
      "row.cancelAdd": "取消",
      "row.projectsEmptyTitle": "还没有管辖项目",
      "row.projectsEmptyText": "新增后，LDVH 才会在该项目中启用事实源与 Git Gate。",
      "row.projectsLoading": "正在读取管辖项目…",
      "row.projectPath": "Git 根目录",
      "row.projectId": "项目 ID",
      "row.projectIdHelp": "用于登记与 CLI 调用的唯一标识（小写字母、数字、连字符；1–64 字符），创建后不可修改。",
      "row.projectIdErrorFormat": "仅可包含小写字母、数字和连字符，且不能以连字符开头或结尾。",
      "row.projectIdErrorLength": "长度需在 1–64 字符之间。",
      "row.projectIdErrorDuplicate": "此 ID 已被其他管辖项目使用。",
      "row.chooseProject": "选择 Git 根目录…",
      "row.pickFailed": "选择文件夹失败：",
      "row.pickUnavailable": "当前环境没有可用的目录选择服务，请直接在路径框中手动输入 Git 根目录。",
      "row.install": "安装",
      "row.installBusy": "安装中…",
      "row.update": "更新修复",
      "row.updateBusy": "更新修复中…",
      "sidebar.label": "LDVH",
      "sidebar.title": "LDVH 信息呈现",
      "row.unregister": "取消管辖",
      "row.check": "检查",
      "row.projectReady": "已就绪",
      "row.projectIncomplete": "未就绪",
      "row.operationFailed": "操作失败",
      "row.apiUnavailable": "LDVH 服务暂不可用，请稍后刷新页面重试；持续失败请检查插件是否已加载",
      "row.projectsUnavailable": "管辖项目列表暂不可用，请先查看上方 Web 呈现状态。",
      "row.projectColor": "项目颜色",
      "row.colorAuto": "自动取色",
      "row.mountConversationTab": "加入到对话 Tab",
      "row.mountSidebarTab": "加入到侧边栏",
      "row.mountHint": "保存后刷新页面生效；两项可分别关闭，关掉哪一项，对应位置就不再出现 LDVH 入口。",
      "row.idleAssistHint": "会话空闲时由宜主派发辅助任务；两项开关分别管发现层与审核层，关掉哪个就少跑哪一层。",
      "row.reviewAsk": "把关请示",
      "row.reviewAskPre": "行动前：询问是否安排代理审查",
      "row.reviewAskPreHint": "打开后，AI 判定当次任务属「复杂任务」时，会在动手前问你要不要先让一个独立子代理挑错。判错了或没判，机械层不会拦——这是按开关执行的自律，不是机械保障。",
      "row.reviewAskPost": "行动后：询问是否安排代理复核",
      "row.reviewAskPostHint": "打开后，一件复杂任务做完、准备收口时，AI 会问你要不要让独立子代理逐条核对已发生的工作。与上面那个开关相互独立：只开这个就只在收口前问。",
      "row.reviewAskSilent": "静默执行：不问，直接安排",
      "row.reviewAskSilentBadge": "静默",
      "row.reviewAskSilentHint": "打开后，AI 判定当次属「复杂任务」时不再问你，直接派一个独立子代理做那次审查／复核，做完在结论里留一行「静默执行」的痕迹。**它只免掉询问，不免掉核对**，也只作用于上面两项；ADR、火花、管辖项目这些真正要你点头的事照旧请示。上面两项都没开时，这项不起作用。",
      "row.idleCapture": "闲置捕获",
      "row.idleCaptureHint": "会话静置时派发一次发现：把反复出现的阻碍与已解决的失败机制**只写进观察缓冲**，不直接改账本（已实现）。摩擦与经验同属这一层，一起跑——只开一半会产生半套材料，所以合并为一个开关。",
      "row.auxReview": "闲置审核",
      "row.auxReviewHint": "静置时派发一次审核：把缓冲里的材料**升级为事实对象**——摩擦观察攒够 3 次就建成摩擦账目，经验观察够格的写成经验草稿（草稿是否入档仍需你确认）。同一项目同一时间至多一个审核在跑。与「闲置捕获」相互独立：关掉它只是不再自动升级，材料仍留在缓冲里。",
"row.injectionBudgetTier": "召回预算档位（K 字节）",
      "row.injectionBudgetTierHint": "行动前召回的体量上限，可选 10/20/30/40/50（K 字节）。档位值本身是受控常量（改档位集合须走受控提交），此处只做选择；提高上限属 Human 决定事项。引导面（管辖判定与最小规则引导）是固定内容，不参与本档位。",
      "row.idleSilenceMs": "安静时长（分钟）",
      // **一句话解释**（Human 2026-10-14 明确要求）：说清「什么是安静时长」——
      // 即它衡量的是「对话停了多久」，而不是「距上次跑完多久」。这句话须自足：
      // Human 不必回读 36 号规范即可判断该填多少。
      "row.idleSilenceMsHint": "指对话停下来后、连续安静多久才允许做一次闲时回顾：只要还有新的对话活动，计时就重新开始；真正停下来满这个时长，才回顾一次。",
      "row.idleLimitInvalid": "请填入整数；安静时长须大于 0（配额上限填 0 表示不限）。",
      // 第十三轮：总开关撤除，故本句不再描述「关闭/开启」——没有那个控件了。
      // 改成说这一组管什么、以及结论去哪儿看（读数就在组名右侧）。
      "row.webHint": "插件自带的页面与 API；是否可用见标题旁的读数，两项投放决定入口出现在哪里。",
      // 存量配置的出口说明：`webEnabled: false` 仍作数（服务端确实不挂路由），
      // 但设置面已不提供这个开关——不写清去处，用户就只剩一个关不回来的死角。
      "row.webDisabledNote": "配置文件里关掉了 Web 呈现（webEnabled: false），故两项投放不可用。设置面已不再提供这个开关；需要时请在插件配置文件中改回 true。",
      "row.idleDisabledNote": "配置文件里关掉了闲时派发（idleAssistEnabled: false），故这两个子项不可用。设置面已不再提供这个开关；需要时请在插件配置文件中改回 true。",
      "row.status": "Web 呈现状态",
      "row.statusChecking": "检测中…",
      "row.statusOk": "运行正常",
      "row.statusUnmounted": "未挂载",
      "row.statusFail": "运行异常",
      "row.save": "保存",
      // 有未保存改动时的按钮文案（Human 2026-10-14 要求「显示为需要保存」）。
      "row.saveDirty": "保存改动",
      "row.saveDirtyAria": "有未保存的更改，点此保存",
      "row.saving": "保存中…",
      "row.discard": "放弃修改",
      "row.cheer": "鼓励一下",
      "row.saved": "已保存",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "LDVH 设置已保存。",
      "view.label": "LDVH",
      "view.loading": "正在加载 LDVH Web…",
      "view.error": "LDVH Web 当前不可用，请确认插件已加载，或稍后重试。",
      "view.retry": "重试",
    };
    var LDVH_EN = {
      // Nav label only — the Settings sidebar clips long names ("LD Vibe Harness…").
      // LDVH is the project's own short name, used throughout the guidance and docs.
      "row.title": "LDVH",
      "row.governanceLocation": "Governed projects configuration",
      "row.governanceLocationHint": "LDVH stores it automatically at ldvh/governed-projects.yaml under the DSH user-config directory.",
      "row.projectsPanelTitle": "Governed projects",
      // Group names (card headers) — see the Chinese table for the rationale.
      "group.services": "Service and entries",
      "group.idle": "Idle dispatch",
      "group.budget": "Recall budget",
      "row.addProject": "Add governed project",
      "row.addProjectTitle": "Add governed project",
      "row.addProjectHint": "Pick a Git repository root, or type its absolute path manually. Installing registers the project, initializes ldvh-base/, and installs the Git Hook in one step.",
      "row.cancelAdd": "Cancel",
      "row.projectsEmptyTitle": "No governed project yet",
      "row.projectsEmptyText": "Add one to enable the fact source and Git Gate for that project.",
      "row.projectsLoading": "Loading governed projects…",
      "row.projectPath": "Git root",
      "row.projectId": "Project ID",
      "row.projectIdHelp": "Unique identifier for registration and CLI calls (lowercase letters, digits, and hyphens; 1–64 chars). Cannot be changed after creation.",
      "row.projectIdErrorFormat": "Only lowercase letters, digits, and hyphens; cannot start or end with a hyphen.",
      "row.projectIdErrorLength": "Must be between 1 and 64 characters.",
      "row.projectIdErrorDuplicate": "This ID is already used by another governed project.",
      "row.chooseProject": "Choose Git root…",
      "row.pickFailed": "Folder selection failed: ",
      "row.pickUnavailable": "No directory-picker service is available in this environment; type the Git root path manually.",
      "row.install": "Install",
      "row.installBusy": "Installing…",
      "row.update": "Update & Repair",
      "row.updateBusy": "Updating & repairing…",
      "sidebar.label": "LDVH",
      "sidebar.title": "LDVH presentation",
      "row.unregister": "Stop governing",
      "row.check": "Check",
      "row.projectReady": "Ready",
      "row.projectIncomplete": "Not ready",
      "row.operationFailed": "Operation failed",
      "row.apiUnavailable": "The LDVH service is unavailable. Refresh the page and retry; if it keeps failing, check that the plugin is loaded.",
      "row.projectsUnavailable": "The governed-project list is unavailable. Check the Web presentation status above first.",
      "row.projectColor": "Project color",
      "row.colorAuto": "Auto color",
      "row.mountConversationTab": "Add to conversation tab",
      "row.mountSidebarTab": "Add to sidebar",
      "row.mountHint": "Takes effect after saving and reloading the page; either mount can be turned off independently — the matching LDVH entry then stops appearing.",
      "row.idleAssistHint": "The assistant dispatches auxiliary tasks while the session is idle; the two switches cover the discovery layer and the review layer respectively.",
      "row.reviewAsk": "Review checkpoints",
      "row.reviewAskPre": "Before acting: ask whether to arrange an agent review",
      "row.reviewAskPreHint": "When on, and the AI judges the task to be a complex task, it will ask you whether an independent subagent should look for problems first. If it judges wrongly or not at all, nothing blocks it — this is self-discipline driven by a switch, not a mechanical guarantee.",
      "row.reviewAskPost": "After the work: ask whether to arrange an agent re-check",
      "row.reviewAskPostHint": "When on, and a complex task is done and about to be closed out, the AI will ask whether an independent subagent should check the work item by item. Independent of the switch above: enabling only this one asks only before closing out.",
      "row.reviewAskSilent": "Silent run: skip the question, arrange it directly",
      "row.reviewAskSilentBadge": "silent",
      "row.reviewAskSilentHint": "When on, and the AI judges the task to be a complex task, it no longer asks you: it dispatches an independent subagent for that review directly and leaves a one-line “silent run” trace in the result. **It removes the question, not the check**, and applies only to the two items above — ADRs, Sparks and project registration, which genuinely need your yes, are still asked. With both items above off, this switch has nothing to act on.",
      "row.frictionDiscovery": "Friction discovery",
      "row.frictionDiscoveryHint": "Records recurring obstacles from the real workflow into the friction ledger (implemented).",
      "row.idleCapture": "Idle capture",
      "row.idleCaptureHint": "When the conversation goes quiet, runs one discovery pass that writes recurring obstacles and resolved failure mechanisms into the observation buffers only, never into the ledger (implemented). Friction and experience belong to this same layer and run together — enabling only half would produce half the material, so they share one switch.",
      "row.auxReview": "Idle review",
      "row.auxReviewHint": "When the conversation goes quiet, runs one review pass that promotes buffered material into fact objects: friction observations reaching 3 sightings become ledger entries, qualifying experience observations become experience drafts (filing a draft still needs your confirmation). At most one review runs per project at a time. Independent of capture: turning it off stops auto-promotion only, and material stays buffered.",
"row.injectionBudgetTier": "Recall budget tier (KiB)",
      "row.injectionBudgetTierHint": "Size cap for pre-action recall: choose 10/20/30/40/50 (KiB). The tier set itself is a controlled constant (changing it requires a controlled commit); this field only selects. Raising the cap is a Human decision. The guidance surface (jurisdiction verdict + minimal guidance) is fixed and does not share this tier.",
      "row.idleSilenceMs": "Silence duration (minutes)",
      "row.idleSilenceMsHint": "How long the conversation must stay quiet before a single idle review may run: any new activity restarts the count, and one review happens once the silence reaches this duration.",
      "row.idleLimitInvalid": "Enter an integer; the silence duration must exceed 0 (0 in the cap means unlimited).",
      "row.webHint": "The plugin's own page and API; availability shows in the readout beside the title, and the two placements decide where the entry appears.",
      "row.webDisabledNote": "Web presentation is switched off in the config file (webEnabled: false), so both placements are unavailable. This switch is no longer offered in Settings; set it back to true in the plugin config file if you need it.",
      "row.idleDisabledNote": "Idle dispatch is switched off in the config file (idleAssistEnabled: false), so these two items are unavailable. This switch is no longer offered in Settings; set it back to true in the plugin config file if you need it.",
      "row.status": "Web presentation status",
      "row.statusChecking": "Checking…",
      "row.statusOk": "Running normally",
      "row.statusUnmounted": "Not mounted",
      "row.statusFail": "Unavailable",
      "row.save": "Save",
      "row.saveDirty": "Save changes",
      "row.saveDirtyAria": "You have unsaved changes; click to save",
      "row.saving": "Saving…",
      "row.discard": "Discard changes",
      "row.cheer": "Star on GitHub",
      "row.saved": "Saved",
      "row.saveFailed": "Could not save. Try again.",
      "row.toastSaved": "LDVH settings saved.",
      "view.label": "LDVH",
      "view.loading": "Loading LDVH Web…",
      "view.error": "LDVH Web is unavailable. Check that the plugin is loaded, or try again later.",
      "view.retry": "Retry",
    };

    // Mechanical ID validation. Slug rule mirrors chooseProject(): lowercase
    // alphanumeric with single hyphens between segments; no leading/trailing
    // hyphen. "required" is silent in the UI (handled by disabled install).
    function computeIdError(id, projects) {
      if (!id) return "required";
      if (id.length > 64) return "length";
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) return "format";
      if (projects && projects.some(function (p) { return p && p.id === id; })) return "duplicate";
      return null;
    }
    function idErrorMessage(key, t) {
      if (key === "format") return t("row.projectIdErrorFormat");
      if (key === "length") return t("row.projectIdErrorLength");
      if (key === "duplicate") return t("row.projectIdErrorDuplicate");
      return null;
    }

    // ── iframe origin 分流（2026-10-17 修复：远程浏览器访问时项目列表错位）──
    //
    // 背景：DSH Web GUI 可经局域网访问（宿主 webServer 以 0.0.0.0 监听）。此时
    // 主文档源是 http(s)://<服务器地址>，而下方「地址形状」注释所述的回环方案
    // 是为 dsh-app://app 桌面客户端设计的——那套方案里 iframe 直连 127.0.0.1
    // 的 Web API 子进程。浏览器里的 127.0.0.1 指向**访问设备自己**：iframe 于是
    // 连到访问设备本地的 LDVH 服务（读到它本机的 governed-projects.yaml），
    // 或因对方没有服务而打不开——实测表现为「远程访问时管辖项目列表少项目 /
    // 加载失败，本地桌面端一切正常」。
    //
    // 分流判据是主文档协议（构造统一收口在 webFrameOrigin，两个消费点
    // ldvhWebOrigin / applyWebPort 不得各自内联一份判定）：
    //   - dsh-app:（桌面客户端）保留回环直连——子框架过宿主转发链会 403
    //     （见下方 2026-09-25 的「地址形状」注释），行为与分流前逐字不变；
    //   - http/https（浏览器，本机或远程）改用当前 origin——宿主 webServer
    //     已挂载 /ldvh 静态与 /ldvh/api 代理，iframe 与主文档同源，认证
    //     cookie 自动携带，读到的是**服务器**的登记数据。
    var LDVH_APP_PROTOCOL = "dsh-app:";
    function webFrameOrigin(port) {
      // 无 window/location 的环境（Node vm 测试沙箱）守卫：退回回环地址。
      if (typeof window === "undefined" || !window.location) return "http://127.0.0.1:" + port;
      if (window.location.protocol === LDVH_APP_PROTOCOL) return "http://127.0.0.1:" + port;
      return window.location.origin;
    }

    // 端口不硬编码：宿主侧端口可被 LDVH_WEB_API_PORT 覆盖，硬编码会与宿主漂移。
    // 以宿主 health 返回的 `webPort` 为准（见 discoverWebPort），尚未取到时用
    // 编译期默认值兜底，避免首帧空 src。
    var LDVH_WEB_PORT_DEFAULT = 3299;
    var ldvhWebPort = LDVH_WEB_PORT_DEFAULT;
    var ldvhWebOrigin = webFrameOrigin(ldvhWebPort);
    var ldvhFrameLocation = ldvhWebOrigin + "/ldvh/";
    /** 端口就绪后重写 iframe 地址（保留当前记忆路径）。 */
    function applyWebPort(port) {
      if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) return;
      if (port === ldvhWebPort) return;
      ldvhWebPort = port;
      ldvhWebOrigin = webFrameOrigin(ldvhWebPort);
      var tail = ldvhFrameLocation.indexOf("/ldvh") >= 0 ? ldvhFrameLocation.slice(ldvhFrameLocation.indexOf("/ldvh")) : "/ldvh/";
      ldvhFrameLocation = ldvhWebOrigin + tail;
    }

    // ── 探活口径（2026-10-09）────────────────────────────────
    //
    // 原实现探活用相对路径 /ldvh/api/health，命中的是**宿主**路由：宿主自己能答
    // 200，于是子进程已死、iframe 实为空白时，探活仍报「可用」——「可用」不代
    // 表 iframe 的真实可用性，设置卡与降级提示因此失真。
    //
    // 现在改为两段：
    //   ① 端口发现仍走宿主 /ldvh/api/health——**唯一**能取到 webPort 的通道
    //      （主框架请求才过宿主转发链，子框架拿不到身份头，见下方地址形状说明）；
    //   ② 就绪判定走 **iframe 真正要连的那个绝对地址**（见 webFrameOrigin 的
    //      origin 分流：dsh-app 桌面场景为回环子进程，浏览器场景为当前 origin）。
    //
    // 跨源：主文档源是 dsh-app://app 时，直连 127.0.0.1 属跨源，且子进程 cors()
    // 白名单只放行本机 dev server。故用 mode:"no-cors" 的不透明响应——它读不到
    // 状态码与响应体，但**能否 resolve 本身就是连通性结论**，而连通性正是此处
    // 要问的问题。cors 拒绝会落在 resolve 成功上（不透明响应照样送达），故本
    // 口径不受白名单影响。
    //
    // **它能判什么、不能判什么（独立复核指出，据实收紧）**：不透明响应只区分
    // 「连得上 / 连不上」。子进程以 500 应答、dist 未构建而回 503、端口被别的
    // 进程占用——三者都 resolve，页面却仍是打不开的。所以「就绪」不能只看它。
    // 于是分两层：
    //   - 探活结论（要不要给 iframe）= 连得上 **且** 健康端点自报 success；
    //   - 后者经 no-cors 读不到，故由子进程自己在响应头里回一个可被不透明响应
    //     之外的通道取到的标记——见 probeHealthStatus 的同源降级。
    // 保留 no-cors 这一层仍必要：它证明「iframe 那个地址真的在服务」，而这正是
    // 本单要修的那个口径。
    function probeLoopback(path, then) {
      try {
        fetch(ldvhWebOrigin + path, { method: "GET", mode: "no-cors", cache: "no-store" })
          .then(function () { then(true); })
          .catch(function () { then(false); });
      } catch (error) {
        void error;
        then(false);
      }
    }

    /**
     * 健康自报：走 cors 正常的读法取状态码与响应体，据此区分「在服务」与「健康」。
     *
     * 子进程在 /api/health 上回 `Access-Control-Allow-Origin: *` 与
     * `X-LDVH-Health: ok`（见 plugin/web/api/app.ts 的说明），
     * 所以这一步在真实部署下**读得到**——不透明响应那条弱结论是兜底，不是常态。
     *
     * 弱结论边界仍如实保留：若子进程被换成不带这些头的实现，cors 会拒收，
     * 此时只剩「有东西在应答」，判不出 500/503。调用方据 state 区分展示，
     * 不把弱结论表述成「健康」。
     */
    /**
     * 健康自报判据——两种应答形状（2026-10-17 起两形兼容）：
     *   - 子进程直连（dsh-app 桌面场景，iframe 直连回环子进程）：/api/health
     *     回 { success: true, message: "ok" }（见 plugin/web/api/app.ts）；
     *   - 宿主路由（浏览器场景，iframe 走当前 origin）：/ldvh/api/health 优先
     *     命中插件本地路由（lib/index.js 的 createApiHandler，先于代理），
     *     回 { ok: true, service: "dsh-ldvh", status: "ok", webPort }——无
     *     success 字段。判据只认其一会让另一个场景的探活恒判 unhealthy，
     *     LDVH 视图永远落进失败分支。
     */
    function healthBodyOk(body) {
      if (body && body.success === true) return true;
      return Boolean(body && body.ok === true && body.status === "ok");
    }
    function probeHealthStatus(then) {
      fetch(ldvhWebOrigin + "/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) {
          if (!r.ok) { then(false, "unhealthy"); return; }
          return r.json().then(function (body) {
            then(healthBodyOk(body), healthBodyOk(body) ? "healthy" : "unhealthy");
          }, function () {
            // 读不到体（实现变了或被代理改写）：退到「连得上」的弱结论。
            then(true, "reachable");
          });
        })
        .catch(function () {
          // cors 拒收或网络不可达：退到不透明连通性判定。
          probeLoopback("/ldvh/api/health", function (reachable) {
            then(reachable, reachable ? "reachable" : "unreachable");
          });
        });
    }

    /** 宿主侧 health：只用来发现 webPort，不再作为就绪结论。 */
    function discoverWebPort() {
      return fetch("/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (body) {
          if (body && body.ok === true && body.webPort !== undefined) applyWebPort(body.webPort);
          return !!(body && body.ok === true);
        })
        .catch(function () { return false; });
    }

    // Health probe: the view is "ready" only when the iframe's own origin serves
    // the page AND the backend self-reports healthy — 探活 URL 与 iframe 地址同源
    // 同端口，「可用」才代表页面真能打开。健康自报不可得（cors）时退回连通性结论，
    // 该弱边界见 probeHealthStatus 的声明。
    function checkHealth(then) {
      discoverWebPort()
        .catch(function () { return false; })
        .then(function () {
          return new Promise(function (done) {
            probeLoopback("/ldvh/", function (pageReachable) {
              if (!pageReachable) { done(false); return; }
              probeHealthStatus(function (healthy) { done(healthy); });
            });
          });
        })
        .then(then, function () { then(false); });
    }

    // Web-presentation probe: independently checks that the backend API and the
    // /ldvh SPA page are both reachable **on the iframe's own origin**（原实现探
    // 宿主路由，子进程死时仍报可用）。Both are real HTTP probes (no Host-side
    // state mirror), so the card always reports the true runtime.
    function probeWeb(then) {
      var out = { api: false, page: false, apiState: "unreachable", pageState: "unreachable" };
      discoverWebPort()
        .catch(function () { return false; })
        .then(function () {
          return Promise.all([
            new Promise(function (done) {
              probeHealthStatus(function (healthy, state) { out.api = healthy; out.apiState = state; done(); });
            }),
            new Promise(function (done) {
              probeLoopback("/ldvh/", function (ok) {
                out.page = ok;
                out.pageState = ok ? "reachable" : "unreachable";
                done();
              });
            }),
          ]);
        })
        .then(function () { then(out); })
        .catch(function () { then(out); });
    }

    // ── settings row helpers ─────────────────────────────────────────────
    function useSettingsScopeSnapshot(scope) {
      var snapshotState = React.useState(scope.getSnapshot());
      React.useEffect(function () {
        function update() { snapshotState[1](scope.getSnapshot()); }
        return scope.subscribe(update);
      }, [scope]);
      return snapshotState[0];
    }

    function callLdvhApi(path, body) {
      return fetch("/ldvh/api" + path, {
        method: body === void 0 ? "GET" : "POST",
        cache: "no-store",
        headers: body === void 0 ? void 0 : { "content-type": "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify(body)
      }).then(function (response) {
        return response.text().then(function (text) {
          if (text.length === 0) throw new Error("LDVH 服务返回了空响应");
          try {
            return JSON.parse(text);
          } catch (error) {
            throw new Error("LDVH 服务返回了无法解析的响应");
          }
        });
      });
    }

    // ── LdvhSettingsRow: governed projects + web switch ──────────────────
    /**
     * 闲时辅助的数值参数（**单一来源**；2026-10-14 收为**一个**：安静时长）。
     *
     * `scale` 是「**显示单位**与**存储单位**的比値」：界面上用分钟读写，而存进
     * Config 的是**毫秒**（服务端 `idle-settings.js` 按毫秗判定）。与 mnemon 的
     * `minIntervalMs` 用 `scale: 1000` 同法——用户不应该被要求往输入框里敲
     * 六位数字。
     *
     * **单位只在这里定一次**：标签文案取自 `row.<key>单位` 词条，读取与写入
     * 都过 `scale`，不得在 UI 那一段另写一套换算。
     */
    var IDLE_LIMITS = [
      // **本表现只有一个参数**（2026-10-14 二次修订，11 §6.2 收为**空集**）。
      //
      // 原含五项 → 当轮收为三项 → 本轮收为**一项**。配额上限与窗口长度两项
      // 随 §6.2 的最后一道准入约束一并取消：安静时长已在结构上界定派发频率
      // （两次派发之间必隔「新活动 + 一个安静期」），配额在实测中**从未绑定**
      // （1 小时窗口内最多用到 3、上限 4），却要求 Human 在设置面上判断其取值
      // ——「一个参数就可以控制其他的了……否则会乱」（Human 2026-10-14）。
      //
      // 界面用分钟，存储用毫秒。**须为正数**——写入侧另有下界判定（见
      // idleSilenceOk）。
      // **现只有一项**（2026-10-27 二次修订）：审核的「间隔」已整体删除——审核随
      // 静置触发，与捕获共用同一个时机，没有第二个数值可配。Human 原话：
      // 「==，这个不存在时间了呀，随静置触发」。故此处只剩形态 1 的空窗。
      { key: "idleSilenceMs", scale: 60000, hintKey: "row.idleSilenceMsHint" }
    ];
    /**
     * 各参数的**存储单位**默认值——**必须与服务端
     * `idle-settings.js` 的 `IDLE_DEFAULTS` 逐字一致**（有契约测试比对两处）。
     * 两处漂移会让「设置页显示 A、实际生效 B」——用户永远看不到真实值。
     */
    var IDLE_DEFAULT_STORED = {
      idleSilenceMs: 300000
    };
    /**
     * 召回预算的**已登记档位**（K 字节）。
     *
     * **必须与服务端 `source-recall.js` 的 `INJECTION_BUDGET_TIERS` 逐字一致**
     * ——两处漂移会让「设置页选 20K、实际生效 10K」，而用户永远看不到真实值
     * （同 `IDLE_DEFAULT_STORED` 的契约要求）。
     *
     * 为什么是下拉选择而非自由输入：档位集合是受控常量（`10 §5.3`
     * 「预算的承载形态」），任意数值会让审计无法确定当时生效的是哪一版。
     */
    var INJECTION_BUDGET_TIER_OPTIONS = [10, 20, 30, 40, 50];
    var INJECTION_BUDGET_TIER_DEFAULT = 10;
    /** 档位是否合法（须为已登记成员）。 */
    function injectionBudgetTierOk(value) {
      var n = Number(value);
      return INJECTION_BUDGET_TIER_OPTIONS.indexOf(n) !== -1;
    }
    /** 存储值 → 界面文本（除以 scale）。非法存储值落回空串（由校验拦下）。 */
    function idleLimitToText(value, scale) {
      if (value === undefined || value === null || value === "") return "";
      var n = Number(value);
      if (!Number.isFinite(n) || n < 0) return "";
      return String(n / scale);
    }
    /**
     * 界面文本 → 存储值（乘以 scale）。非法文本返回 `undefined`。
     *
     * **判据含一道「往返无损」检查**：存起来的值除回去必须与用户输入的数一致。
     *
     * 为什么单靠 `Number.isInteger(stored)` 不够：浮点乘法会让某些分钟值乘出**看似
     * 整数但实为舍入**的结果，而那个结果除回去已不是原数——用户下次
     * 打开设置页看到的数与他输入的对不上，且毫无提示。
     *
     * **但不得把它误用为「不允许小数」**：实测 `0.333 分钟 = 19980 毫秒`
     * 往返**确实无损**（`19980 / 60000` 精确等于 `0.333`），故它是合法输入。
     * 本判据只拦「换算后不能原样还原」的值，不拦小数。
     */
    function idleLimitToStored(text, scale) {
      if (typeof text !== "string" || text.trim() === "") return undefined;
      var n = Number(text);
      if (!Number.isFinite(n) || n < 0) return undefined;
      var stored = n * scale;
      if (!Number.isInteger(stored) || stored < 0) return undefined;
      // 往返无损：存起来的值除回去必须与用户输入的数字一致。
      // 用数值比较而非字符串比较（`"10"` 与 `"10.0"` 是同一个数）。
      if (Number(idleLimitToText(stored, scale)) !== n) return undefined;
      return stored;
    }

    /**
     * 安静时长的**下界判定**（11 §6.1，2026-10-14）。
     *
     * §6.1 明文：安静时长的取值**须为有限正值**——取 0 会使「已空闲」恒成立
     * （等价于取消该判据），且该非法取值**须在写入时被拒绝并提示**，**不得**静默
     * 回落为默认值。故本项单独拦一层：`0` 对配额上限是合法的（表示不限），
     * 对安静时长**不合法**——两者的 0 语义相反，不能共用一条判据。
     */
    function idleSilenceOk(text) {
      var stored = idleLimitToStored(text, 60000);
      return stored !== undefined && stored > 0;
    }

    function LdvhSettingsRow(props) {
      var t = props.t;
      var scope = props.settingsScope;
      // `surface === "settings"` 表示本节由**设置页**承载（宿主提供面板骨架：
      // 标题、关闭按钮都在宿主那边），与 Plugins 页的折叠卡片不同。当前内容
      // 两种承载下完全相同，故不据此分支——保留读取只为将来需要差异化时
      // 有明确入口，而不是届时去猜「这个组件被谁挂载」。
      var snap = useSettingsScopeSnapshot(scope);
      var value = (snap && snap.status === "ready" && snap.value) || {};
      // **两个总开关已撤除（Human 2026-11-13 晚，看真机截图直接指示）**：
      // 「启用 LDVH Web 呈现」与「闲时派发」这两枚 master 开关不再出现在设置面，
      // 也不再持有本地态——它们所管的东西改为**无条件生效**（web 恒挂载、
      // 闲时辅助恒可派发）；这两组里真正需要关的东西，仍由各自的子项开关表达
      // （投放面：对话 Tab / 侧边栏；闲时：闲置捕获 / 闲置审核）。
      // 撤除的是「再套一层总闸」，不是任何一项能力：把两个投放面都关掉，界面上
      // 就不再出现 LDVH 入口（`/ldvh` 路由仍由插件服务承担，故这不等于关服务）；
      // 把两个闲时子项都关掉，就没有活儿会派发——比总闸还细一档。
      //
      // **但这两个值仍会被读**（只是不再由本页写）：配置文件里若显式写了
      // `webEnabled: false` / `idleAssistEnabled: false`，服务端照旧按它行事
      // ——此时子项**显示为禁用**、状态读数显示「未挂载」，而不是照常可点却
      // 什么也不发生（本仓纪律：不得让读数不可判读）。改这一层要动
      // profile 配置，不在设置面上。
      var webOn = value.webEnabled !== false;
      var idleOn = value.idleAssistEnabled !== false;
      var convTabState = React.useState(value.showInConversationTab !== false);
      var sidebarTabState = React.useState(value.showInSidebarTab !== false);
      // **2026-10-30 配置面合并为两项**（Human 决定）：闲置捕获（发现层）与闲置审核
      // （审核层）。原先是六个开关（摩擦发现/经验捕获/经验审核/容量维护/记忆健康），
      // 合并理由见 index.js 的 schema 注释：同层任务在同一次派发里一起跑，拆开只会
      // 产生「半套材料」而痕迹里看不出原因。
      //
      // 读侧仍兼容旧键：旧键任一被显式设置过即生效（与服务端 resolveIdleSettings
      // 同一判据），使升级后 Human 此前的选择不会静默丢失。
      var idleCaptureState = React.useState(idleCaptureValueOf(value));
      var idleReviewState = React.useState(idleReviewValueOf(value));
      // 数值参数在客户端用**字符串**存放，使空串与非法输入可被辨认
      //（数字类型无法表达「用户把它删空了」）。
      // **两处把关询问**（2026-11-13 Human 决定：改为「要不要安排代理
      // 审查／复核」两问，各由开关控制，打开才有）。
      //
      // 缺省按 `false`（关）：与 schema 的 `.default(false)` 同一口径。注意这里
      // 用 `=== true` 而不是 `!== false`——后者会把「未设置」当成开，与默认相反。
      var preActionReviewState = React.useState(value.preActionReviewAskEnabled === true);
      var postWorkReviewState = React.useState(value.postWorkReviewAskEnabled === true);
      // **静默执行**（2026-11-13 晚 Human 确认 A1）：两枚询问开关的**执行档位**，
      // 不是第三处把关。缺省关（与 schema 一致），用 `=== true` 判读——理由同上面两行。
      var reviewSilentState = React.useState(value.reviewAskSilentRunEnabled === true);
      // **审核模型设置已整体移除**（2026-10-27 Human 要求）：该设置从未真正生效
      // ——设置面能填能存，审核执行体却一直按默认路由跑（诊断长期显示
      // `model: (default route)`）。一个「设了不生效」的选项比没有更糟。
      // 审核固定跟随宿主默认路由。
      // 闲置捕获 / 闲置审核的读值口径（读侧与「放弃修改」回退侧共用一处）。
      // 旧键兼容：旧键任一被显式设置过即生效（与服务端 resolveIdleSettings 同一判据）。
      function idleCaptureValueOf(value) {
        return (value.frictionDiscoveryEnabled !== undefined || value.experienceCaptureEnabled !== undefined)
          ? (value.frictionDiscoveryEnabled !== false && value.experienceCaptureEnabled !== false)
          : value.idleCaptureEnabled !== false;
      }
      function idleReviewValueOf(value) {
        return (value.experienceReviewEnabled !== undefined || value.idleReviewEnabled !== undefined)
          ? (value.experienceReviewEnabled === true || value.idleReviewEnabled === true)
          : value.auxReviewEnabled === true;
      }
      // 数值参数的界面态（分钟文本）——读侧与回退侧共用。
      function idleLimitsTextOf(value) {
        var out = {};
        IDLE_LIMITS.forEach(function (limit) {
          var stored = value[limit.key] !== undefined ? value[limit.key] : IDLE_DEFAULT_STORED[limit.key];
          out[limit.key] = idleLimitToText(stored, limit.scale);
        });
        return out;
      }
      // 界面上的各值按它们**各自的显示单位**存放（见 IDLE_LIMITS 的 scale）。
      // 缺省值用**存储单位**给出，再过同一条换算——而不在这里另写一份「分钟数」，
      // 否则改默认值时会漏改一处。
      // 召回预算档位（K 字节）——受控常量集合中的选择，非法值在保存前拦下。
      var injectionBudgetState = React.useState(
        injectionBudgetTierOk(value.injectionBudgetTier) ? Number(value.injectionBudgetTier) : INJECTION_BUDGET_TIER_DEFAULT
      );
      var idleLimitsState = React.useState(idleLimitsTextOf(value));
      // 各参数的合法判定——判的是**存储值**（毫秒），不是界面文本。
      //
      // 为什么必须判存储值：界面以分钟读写，而分钟×60000 可能得到非整数
      // （如用户输入 `0.333`）——那个值送进 Config 后，服务端的整数判定会把
      // 它当非法而静默回落默认，用户看到的与生效的就不一致。故在这里就拦下。
      function idleLimitOk(text, scale) {
        return idleLimitToStored(text, scale) !== undefined;
      }
      // 逐参数判据：安静时长另有**下界**要求（须 > 0，11 §6.1），配额上限的 0 合法。
      function idleLimitOkFor(key, text) {
        // **两个时机数值都须 > 0**（2026-10-26）：审核间隔与安静时长同性质——§6.1
        // 明文「非法取值须在写入时拒绝」，而 0 分钟会让「到点」恒成立（等价取消时机
        // 约束）。配额类的 0 合法（表示不限），故不能共用同一条判据。
        if (key === "idleSilenceMs") return idleSilenceOk(text);
        var limit = IDLE_LIMITS.filter(function (l) { return l.key === key; })[0];
        return limit !== undefined && idleLimitOk(text, limit.scale);
      }
      function idleLimitsAllOk(limits) {
        return IDLE_LIMITS.every(function (limit) {
          return idleLimitOkFor(limit.key, limits[limit.key]);
        });
      }
      var dirtyState = React.useState(false);
      var busyState = React.useState(false);
      var savedState = React.useState(false);
      var saveErrorState = React.useState(false);
      // **保存失败的真实原因**（2026-11-13 修）。
      //
      // 此前 `.catch(function () { saveErrorState[1](true); })` 把错误**整个吞掉**，
      // 界面上只剩「保存失败，请重试。」——而宿主拒绝写入的原因（字段非 volatile、
      // revision 冲突、条目不可配置……）恰恰是唯一能定位问题的信息。实测代价：
      // 保存失败后无从判断原因，只能去翻源码与宿主实现反推。
      //
      // 本仓纪律「不得让读数不可判读」在这里的落点：错误可以失败，但**原因必须可见**。
      var saveErrorDetailState = React.useState("");
      var toastState = React.useState(null);
      var toastSeq = React.useRef(0);
      var webStatusState = React.useState({ checking: true, api: false, page: false });
      var projectsState = React.useState({ loading: true, value: null, error: null, unavailable: false });
      var candidateState = React.useState({ path: "", id: "" });
      var addingState = React.useState(false);
      var projectBusyState = React.useState(false);
      var installErrorState = React.useState(null);
      var directoryPicker = props.directoryPicker;

      function loadProjects() {
        projectsState[1]({ loading: true, value: projectsState[0].value, error: null, unavailable: false });
        callLdvhApi("/governed-projects/with-colors")
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "project list unavailable");
            projectsState[1]({ loading: false, value: result.value, error: null, unavailable: false });
          })
          .catch(function (error) {
            var message = String(error.message || error);
            var isTransport = message.indexOf("LDVH 服务返回了空响应") !== -1 || message.indexOf("LDVH 服务返回了无法解析的响应") !== -1 || message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1 || message.indexOf("Failed to fetch") !== -1;
            // A transport-level failure is the same condition the Web
            // presentation status row already reports at the top. The reason
            // is stated once, next to that status (Human-confirmed); the
            // projects panel only marks itself unavailable with a pointer
            // instead of repeating the error.
            projectsState[1]({ loading: false, value: null, error: isTransport ? null : message, unavailable: isTransport });
          });
      }

      React.useEffect(function () { loadProjects(); }, []);

      React.useEffect(function () {
        if (dirtyState[0] || busyState[0]) return;
        var next = (snap && snap.status === "ready" && snap.value) || {};
        convTabState[1](next.showInConversationTab !== false);
        sidebarTabState[1](next.showInSidebarTab !== false);
        idleCaptureState[1](idleCaptureValueOf(next));
        idleReviewState[1](idleReviewValueOf(next));
        injectionBudgetState[1](
          injectionBudgetTierOk(next.injectionBudgetTier) ? Number(next.injectionBudgetTier) : INJECTION_BUDGET_TIER_DEFAULT
        );
        // 两处把关询问开关的**外部变更回填**：漏掉这两行，配置被别处改动后
        // 界面仍显示旧勾选态（重开设置页才更新）——勾选态与生效值不一致。
        preActionReviewState[1](next.preActionReviewAskEnabled === true);
        postWorkReviewState[1](next.postWorkReviewAskEnabled === true);
        reviewSilentState[1](next.reviewAskSilentRunEnabled === true);
        idleLimitsState[1](idleLimitsTextOf(next));
        savedState[1](false);
        saveErrorState[1](false);
      }, [snap ? snap.revision : -1, dirtyState[0], busyState[0]]);

      // 探活：随配置 revision 变化重跑一次。**不再判「总开关是否开着」**
      //（2026-11-13 撤除总开关后，web 恒挂载，没有「没挂载所以不必探」这条分支）。
      React.useEffect(function () {
        var cancelled = false;
        webStatusState[1]({ checking: true, api: false, page: false });
        probeWeb(function (out) {
          if (cancelled) return;
          webStatusState[1]({ checking: false, api: out.api, page: out.page });
        });
        return function () { cancelled = true; };
      }, [snap ? snap.revision : -1]);

      // 采用选中的绝对路径：取消（null）不是错误，静默返回。
      function adoptPickedPath(path) {
        if (path === null || typeof path !== "string") return;
        var leaf = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "project";
        candidateState[1]({ path: path, id: leaf.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "project" });
      }
      function chooseProject() {
        if (projectBusyState[0]) return;
        // 目录选择梯级（镜像 DSH Desktop 浏览面板自身的接线）：
        // ① Desktop 窗口预注入桥 window.__DSH_DESKTOP_PICK_DIRECTORY__
        //    （经 /_dsh/desktop/pick-directory 直通主进程 Electron
        //    dialog——win32 Desktop 内可靠的原生弹窗；以页面标记
        //    dsh-desktop-platform=win32 门控，与宿主 browse surface 同款）；
        // ② remote.directoryPicker.pick()（native 后端组合且选择器可用的宿主）。
        // 失败一律进表单错误位（对齐宿主 directoryFlow 契约的 onError），
        // 手动输入路径始终是兜底通道。
        var desktopPick = null;
        try {
          if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dsh-desktop-platform") === "win32"
            && typeof window.__DSH_DESKTOP_PICK_DIRECTORY__ === "function") {
            desktopPick = window.__DSH_DESKTOP_PICK_DIRECTORY__;
          }
        } catch (error) { /* window/query 不可用——走 remote 梯级 */ }
        if (desktopPick !== null) {
          projectBusyState[1](true);
          installErrorState[1](null);
          Promise.resolve(desktopPick()).then(function (path) {
            projectBusyState[1](false);
            adoptPickedPath(path === undefined ? null : path);
          }).catch(function (error) {
            projectBusyState[1](false);
            installErrorState[1](t("row.pickFailed") + (error && error.message ? String(error.message) : ""));
          });
          return;
        }
        if (!directoryPicker || typeof directoryPicker.pick !== "function") {
          installErrorState[1](t("row.pickUnavailable"));
          return;
        }
        projectBusyState[1](true);
        installErrorState[1](null);
        Promise.resolve(directoryPicker.pick()).then(function (result) {
          projectBusyState[1](false);
          if (!result || result.ok !== true || typeof result.value !== "string") return;
          adoptPickedPath(result.value);
        }).catch(function (error) {
          projectBusyState[1](false);
          installErrorState[1](t("row.pickFailed") + (error && error.message ? String(error.message) : ""));
        });
      }
      function openAddForm() {
        installErrorState[1](null);
        addingState[1](true);
      }
      function closeAddForm() {
        installErrorState[1](null);
        candidateState[1]({ path: "", id: "" });
        addingState[1](false);
      }
      function installCandidate() {
        if (!candidateState[0].path || !candidateState[0].id || projectBusyState[0]) return;
        projectBusyState[1](true);
        installErrorState[1](null);
        callLdvhApi("/governed-projects/install", { path: candidateState[0].path, id: candidateState[0].id, name: candidateState[0].id, human_confirmed: true })
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "installation failed");
            closeAddForm();
            loadProjects();
          })
          .catch(function (error) { installErrorState[1](t("row.operationFailed") + ": " + String(error.message || error)); })
          .finally(function () { projectBusyState[1](false); });
      }
      // 项目颜色：调色板交互（十色闭集与 Web shared/projectColors.ts 同源）。
      var PROJECT_COLOR_KEYS = ["emerald", "sky", "violet", "amber", "rose", "cyan", "indigo", "orange", "teal", "fuchsia"];
      // 直接色值（不依赖 --ldvh-pj-* 变量——那是 Web 应用 index.css 的命名空间，
      // 插件设置卡渲染在 DSH 宿主页面里没有这些变量，var() 回落会让色点透明不可见）。
      // 取值与 Web 深色主题一致（宿主设置面板是深色底）。
      var PROJECT_COLOR_VALUES = {
        emerald: "#34d399", sky: "#38bdf8", violet: "#a78bfa", amber: "#fbbf24", rose: "#fb7185",
        cyan: "#22d3ee", indigo: "#818cf8", orange: "#fb923c", teal: "#2dd4bf", fuchsia: "#e879f9"
      };
      function projectColorVar(key) { return PROJECT_COLOR_VALUES[key] || "#999999"; }
      function setProjectColor(projectId, color) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/color", { projectId: projectId, color: color })
          .then(function (result) {
            if (!result || result.ok !== true) {
              // error 可能是 {message} 也可能是字符串（代理 404 等）——两种都给出可读文本，
              // 不留空 message（空 message 经 String(error) 会变成裸 "Error"）。
              var raw = result && result.error;
              var text = raw && typeof raw.message === "string" ? raw.message : (typeof raw === "string" ? raw : "color update failed");
              throw new Error(text);
            }
            loadProjects();
          })
          .catch(function (error) {
            projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
          }).finally(function () { projectBusyState[1](false); });
      }
      function inspectProject(path) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/inspect", { path: path }).then(function () { loadProjects(); }).catch(function (error) {
          projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
        }).finally(function () { projectBusyState[1](false); });
      }
      // "更新" runs the idempotent install transaction: it updates an
      // outdated managed Hook, repairs a missing/incomplete fact source, and
      // re-registers as a no-op when the entry already matches.
      function updateProject(project) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/install", { path: project.path, id: project.id, name: project.name || project.id, human_confirmed: true })
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "update failed");
            loadProjects();
          })
          .catch(function (error) {
            projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
          }).finally(function () { projectBusyState[1](false); });
      }
      function unregisterGovernance(project) {
        projectBusyState[1](true);
        var projects = projectsState[0].value && projectsState[0].value.projects || [];
        var nextDefault = projects.find(function (entry) { return entry.id !== project.id; });
        callLdvhApi("/governed-projects/unregister", { id: project.id, path: project.path, nextDefaultProjectId: nextDefault ? nextDefault.id : "", human_confirmed: true }).then(function (result) {
          if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "unregister failed");
          loadProjects();
        }).catch(function (error) {
          projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
        }).finally(function () { projectBusyState[1](false); });
      }

      function markDirty() {
        savedState[1](false);
        saveErrorState[1](false);
        saveErrorDetailState[1]("");
        dirtyState[1](true);
      }
      function save() {
        if (!snap || snap.status !== "ready" || snap.writable === false || busyState[0]) return;
        // **参数不合法就「不写」**（而不是写一个 NaN 进去）——服务端会把 NaN 回落
        // 默认值，那会让用户看到的值与实际生效的值不一致。故在写入前拦住并如实报失败。
        // （2026-10-14：本节现只有一个参数；`idleLimitsAllOk` 逐键分派，
        //   安静时长另有 `> 0` 的下界判据。）
        if (!idleLimitsAllOk(idleLimitsState[0])) {
          saveErrorState[1](true);
          return;
        }
        busyState[1](true);
        Promise.resolve()
          // 0.1.7 的 SettingsFormScope 没有 set(key, value)：改写为一次带
          // revision fence 的原子 mutate（旧实现是三次独立写入，见调研 §3.2/§3.3）。
          .then(function () {
            var operations = [
              { op: "set", path: ["showInConversationTab"], value: !!convTabState[0] },
              { op: "set", path: ["showInSidebarTab"], value: !!sidebarTabState[0] },
              // 2026-10-30：六个开关合并为两个，保存时只写新键。
              // 旧键不再写入——它们保留在 schema 里仅为读取存量配置；继续写会使
              // 「旧键是否被显式设置过」这个迁移判据永远为真，新键反而被架空。
              { op: "set", path: ["idleCaptureEnabled"], value: !!idleCaptureState[0] },
              // 审核开关独立提交：漏掉这一行，界面上勾了也存不进去，且看不出来
              // （勾选态来自本地 state，保存后仍显示已勾选，重开才归零）。
              { op: "set", path: ["auxReviewEnabled"], value: !!idleReviewState[0] },
              { op: "set", path: ["injectionBudgetTier"], value: Number(injectionBudgetState[0]) },
              // 两处把关询问开关：**逐个独立提交**。漏写任一行则界面上勾了也存不进去，
              // 且看不出来（勾选态来自本地 state，保存后仍显示已勾选，重开才归零）——
              // 同一失效形态在 `auxReviewEnabled` 那行已经踩过一次（见其上注释）。
              { op: "set", path: ["preActionReviewAskEnabled"], value: !!preActionReviewState[0] },
              { op: "set", path: ["postWorkReviewAskEnabled"], value: !!postWorkReviewState[0] },
              // 静默执行开关：**同一失效形态的第三处**（漏写＝界面上勾了也存不进去，
              // 且看不出来——勾选态来自本地 state，保存后仍显示已勾选，重开才归零）。
              { op: "set", path: ["reviewAskSilentRunEnabled"], value: !!reviewSilentState[0] }
            ];
            // 参数各自按 scale 换算回**存储单位**（分钟 × 60000 = 毫秒）。
            // save() 已在前面拦过非法值，故此处不再回落。
            IDLE_LIMITS.forEach(function (limit) {
              operations.push({ op: "set", path: [limit.key], value: idleLimitToStored(idleLimitsState[0][limit.key], limit.scale) });
            });
            return scope.mutate(operations, snap.revision);
          })
          .then(function (accepted) {
            if (accepted === false) throw new Error("LDVH 设置写入被宿主拒绝");
          })
          .then(function () {
            busyState[1](false);
            dirtyState[1](false);
            savedState[1](true);
            saveErrorDetailState[1]("");
            toastSeq.current = toastSeq.current + 1;
            toastState[1]({ seq: toastSeq.current, text: t("row.toastSaved") });
          })
          .catch(function (error) {
            busyState[1](false);
            saveErrorState[1](true);
            // 原因逐字带出（不是「未知错误」）：宿主的 RemoteError 消息往往就是
            // 那句「Config field "x" is not volatile」或 revision 冲突说明。
            saveErrorDetailState[1](String((error && error.message) || error || ""));
          });
      }
      /**
       * 「放弃修改」：把**全部**本地改动退回当前快照。
       *
       * 此前只回退 Web 总开关——改了别的开关后点它，界面仍显示
       * 改动后的值，而 dirty=false 让保存按钮禁用：既存不下去，也看不出没存。
       * 这正是本仓在意的「界面显示与生效值不一致」那一类失效。
       *
       * 回退的字段集合与「外部变更回填」那条 effect **同一组**（少一处即漏一项）。
       */
      function discard() {
        var next = (snap && snap.status === "ready" && snap.value) || {};
        convTabState[1](next.showInConversationTab !== false);
        sidebarTabState[1](next.showInSidebarTab !== false);
        idleCaptureState[1](idleCaptureValueOf(next));
        idleReviewState[1](idleReviewValueOf(next));
        preActionReviewState[1](next.preActionReviewAskEnabled === true);
        postWorkReviewState[1](next.postWorkReviewAskEnabled === true);
        reviewSilentState[1](next.reviewAskSilentRunEnabled === true);
        injectionBudgetState[1](injectionBudgetTierOk(next.injectionBudgetTier) ? Number(next.injectionBudgetTier) : INJECTION_BUDGET_TIER_DEFAULT);
        idleLimitsState[1](idleLimitsTextOf(next));
        dirtyState[1](false);
        savedState[1](false);
        saveErrorState[1](false);
        saveErrorDetailState[1]("");
      }
      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || !dirtyState[0];
      var ws = webStatusState[0];
      // API and page probes remain internal diagnostic evidence; the ordinary
      // settings UI exposes one product-level conclusion only.
      var serviceOk = ws.api && ws.page;
      var serviceValueText = ws.checking
        ? t("row.statusChecking")
        : (!webOn ? t("row.statusUnmounted") : (serviceOk ? t("row.statusOk") : t("row.statusFail")));
      var serviceValueClass = "ldv-status-value" + (ws.checking
        ? " ldv-status-wait"
        : (!webOn ? " ldv-status-wait" : (serviceOk ? " ldv-status-ok" : " ldv-status-fail")));
      // 状态读数：**组的读数**，故与组名同行（2026-11-13 Human 指正：
      // 「总开关该在组名那一行」；总开关本身已于同日晚撤除，读数留下）。
      // 可见文字是结论本身，完整说法留给 aria-label。
      var serviceStatus = React.createElement("span", {
        className: serviceValueClass,
        "aria-label": t("row.status") + "：" + serviceValueText
      }, serviceValueText);
      // The single place a transport-level failure is explained (moved up
      // from the projects panel, Human-confirmed): shown only when the probes
      // actually failed.
      var serviceIssue = ws.checking || !webOn || serviceOk ? null : t("row.apiUnavailable");
      var idError = computeIdError(candidateState[0].id, projectsState[0].value && projectsState[0].value.projects);
      var idErrorText = idErrorMessage(idError, t);
      var idInputClass = "ldv-settings-input" + (idError && idError !== "required" ? " is-error" : "");
      var installBlocked = projectBusyState[0] || !candidateState[0].path || !candidateState[0].id || (idError && idError !== "required");
      var projectRows = projectsState[0].loading
        ? React.createElement("div", { className: "ldv-governance-empty" },
            React.createElement("span", { className: "ldv-governance-empty-icon", "aria-hidden": "true" }, "…"),
            React.createElement("span", { className: "ldv-governance-empty-text" }, t("row.projectsLoading"))
          )
        : (projectsState[0].unavailable
          // Transport-level failure: the reason lives once next to the Web
          // presentation status above; the panel only points up (no duplicate
          // error box) and does not pretend the project list is empty.
          ? React.createElement("span", { className: "ldv-settings-hint" }, t("row.projectsUnavailable"))
          : (projectsState[0].error
            ? React.createElement("div", { className: "ldv-governance-error", role: "alert" }, projectsState[0].error)
            : ((projectsState[0].value && projectsState[0].value.projects || []).length === 0
              ? React.createElement("div", { className: "ldv-governance-empty" },
                  React.createElement("span", { className: "ldv-governance-empty-icon", "aria-hidden": "true" }, "∅"),
                  React.createElement("span", { className: "ldv-governance-empty-title" }, t("row.projectsEmptyTitle")),
                  React.createElement("span", { className: "ldv-governance-empty-text" }, t("row.projectsEmptyText"))
                )
              : React.createElement("div", { className: "ldv-projects" }, (projectsState[0].value.projects || []).map(function (project) {
              var hook = project.status && project.status.hook;
              var factSource = project.status && project.status.factSource;
              var ready = factSource && factSource.state === "ready" && hook && hook.state === "managed";
              // Repairable = the install transaction can fix it: a missing or
              // outdated managed Hook, or an uninitialized/incomplete fact
              // source. Conflict/unavailable states are NOT repairable here
              // (install refuses) and are explained by the detail line below.
              var repairable = (hook && ["absent", "outdated"].includes(hook.state)) || (factSource && ["absent", "incomplete"].includes(factSource.state));
              var notReadyDetail = ready ? null
                : ((factSource && factSource.state !== "ready" && factSource.detail)
                  || (hook && hook.state !== "managed" && hook.detail)
                  || (project.status && project.status.error && project.status.error.message)
                  || null);
              return React.createElement("article", { className: "ldv-project-card", key: project.id },
                React.createElement("div", { className: "ldv-project-head" },
                  React.createElement("span", { className: "ldv-project-idline" },
                    React.createElement("span", { className: "ldv-project-name" }, project.name || project.id),
                    React.createElement("span", { className: ready ? "ldv-status-value ldv-status-ok" : "ldv-status-value ldv-status-fail" }, ready ? t("row.projectReady") : t("row.projectIncomplete")),
                    React.createElement("span", { className: "ldv-project-path" }, project.path)
                  )
                ),
                notReadyDetail ? React.createElement("span", { className: "ldv-settings-hint" }, notReadyDetail) : null,
                React.createElement("div", { className: "ldv-palette", role: "group", "aria-label": t("row.projectColor") },
                  React.createElement("span", { className: "ldv-palette-label" }, t("row.projectColor")),
                  PROJECT_COLOR_KEYS.map(function (key) {
                    var isExplicit = project.color === key;
                    // 自动取色是排他锁：勾选后色点全部暗掉禁用，须先取消勾选才能再选色。
                    var locked = !project.color;
                    return React.createElement("button", {
                      key: key, type: "button",
                      className: "ldv-palette-dot" + (isExplicit ? " ldv-palette-dot-active" : "") + (locked ? " ldv-palette-dot-locked" : ""),
                      title: key, "aria-label": key, "aria-pressed": isExplicit,
                      disabled: projectBusyState[0] || locked,
                      style: { backgroundColor: projectColorVar(key) },
                      onClick: function () { setProjectColor(project.id, key); }
                    },
                      isExplicit ? React.createElement("span", { className: "ldv-palette-check", "aria-hidden": "true" }, "\u2713") : null
                    );
                  }),
                  React.createElement("label", { className: "ldv-check ldv-palette-auto" + (!project.color ? " ldv-palette-auto-on" : "") },
                    React.createElement("input", {
                      type: "checkbox",
                      checked: !project.color,
                      disabled: projectBusyState[0],
                      "aria-label": t("row.colorAuto"),
                      onChange: function (e) { setProjectColor(project.id, e.target.checked ? null : "emerald"); }
                    }),
                    React.createElement("span", { className: "ldv-check-label" }, t("row.colorAuto"))
                  )
                ),
                React.createElement("div", { className: "ldv-project-actions" },
                  React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: function () { inspectProject(project.path); } }, t("row.check")),
                  repairable ? React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: projectBusyState[0], onClick: function () { updateProject(project); } }, projectBusyState[0] ? t("row.updateBusy") : t("row.update")) : null,
                  React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: function () { unregisterGovernance(project); } }, t("row.unregister"))
                )
              );
            })))));
      // ── 行的两个小构件 ────────────────────────────────────────────────
      // 说明文字里的 **强调**：词条按 Markdown 写的 **…**，在纯文本的设置页
      // 会露出星号。这里渲染成真正的强调——**不改动词条本身**（词条仍是
      // 同一句话，只是显示时把标记吃掉）。
      function emphasis(text) {
        if (typeof text !== "string" || text.indexOf("**") === -1) return text;
        return text.split("**").map(function (part, index) {
          if (part === "") return null;
          return index % 2 === 1 ? React.createElement("strong", { key: "emphasis-" + index }, part) : part;
        });
      }
      // 一个设置行：**标题与控件相邻**成一行，说明另起一行、占满整列。
      //
      // 为什么控件不再摆在行的另一端：说明动辄三五行，控件若与标题分居两端，
      // 垂直居中后落在段落中部——它属于哪一条设置全靠猜。相邻之后二者是
      // 一个不可分割的视觉单元，且说明不必为右侧控件让出横向空间。
      //
      // **卡内不分级**（2026-11-13 Human 定）：此前从属项靠缩进 + 左侧导轨 +
      // 更小的字号（13px/400）表达层级，但同一张卡里三行内容被拆成三级，
      // 版面读起来像三件不同的事。实际上它们是**同一类东西**——都是这一组
      // 的选项，只是「要不要它们生效」取决于总开关。故一律同构：同样的
      // 14px/500 标题、同样的行距、同样的分隔线。
      // 「父开关不开、子项不生效」仍要看得出来，但**靠禁用态**表达
      // （总闸关着时这几项变灰不可点），不靠版式分级。
      function settingRow(titleKey, descKey, control) {
        return React.createElement("div", { className: "ldv-row" },
          React.createElement("div", { className: "ldv-row-head" },
            React.createElement("span", { className: "ldv-row-title" }, t(titleKey)),
            React.createElement("span", { className: "ldv-row-control" }, control)
          ),
          descKey ? React.createElement("span", { className: "ldv-row-desc" }, emphasis(t(descKey))) : null
        );
      }
      // 卡头图标：16px 描边线稿，随主题走（stroke=currentColor）。
      function blockIcon(name) {
        var shapes = LDVH_BLOCK_ICONS[name] || [];
        return React.createElement("svg", {
          viewBox: "0 0 16 16", width: 15, height: 15,
          fill: "none", stroke: "currentColor", strokeWidth: 1.6,
          strokeLinecap: "round", strokeLinejoin: "round",
          focusable: "false", "aria-hidden": "true"
        }, shapes.map(function (shape, index) {
          return React.createElement(shape.t, Object.assign({ key: "shape-" + index }, shape.p));
        }));
      }
      // 卡片头：图标 + 组名（+ 可选块级说明 + 右侧动作位）。
      //
      // 说明的归属：**描述整组**的说明放卡头（.ldv-block-desc），**描述某一项**
      // 的说明留在该行下方（.ldv-row-desc）。两者不混——混了就读不出这行说明
      // 是在讲这一项，还是在讲整组。
      //
      // 卡头里的控件分**两个槽位**（2026-11-13 Human 定）：
      //   · readout —— 状态读数（药丸）。它是这一组的**状态**，属于标题那一列，
      //     紧贴组名，读者一眼知道「运行正常」说的是哪一组。
      //   · toggles —— 总开关。它是这一组的**开关**，按宿主的通行做法放在行末
      //     （与全局开关、筛选器同位），扫视整页时开关都落在同一条竖线上，
      //     找起来不必逐行对位。
      //   两者曾合成一个控件组（status 药丸 + 开关并排，且整体推到最右），
      //   那时药丸也被推远，与组名之间隔着一段空白，读起来像另属一块——
      //   故拆开：药丸贴组名，开关回行末。
      function cardHead(iconKey, titleKey, descKey, readout, toggles) {
        var readouts = Array.isArray(readout) ? readout : (readout ? [readout] : []);
        var switches = Array.isArray(toggles) ? toggles : (toggles ? [toggles] : []);
        return React.createElement("div", { className: "ldv-block-head" },
          React.createElement("span", { className: "ldv-block-icon", "aria-hidden": "true" }, blockIcon(iconKey)),
          React.createElement("span", { className: "ldv-block-title-line" },
            React.createElement("span", { className: "ldv-block-title" }, t(titleKey))
          ),
          readouts.length ? React.createElement("span", { className: "ldv-block-control" }, readouts) : null,
          switches.length ? React.createElement("span", { className: "ldv-block-control ldv-block-toggle" }, switches) : null,
          descKey ? React.createElement("span", { className: "ldv-block-desc" }, emphasis(t(descKey))) : null
        );
      }
      // 开关：全页统一用它（此前混用原生复选框与自绘开关，观感两套）。
      //
      // `tone` 只在需要**与「蓝色＝这一项开着」区分**时给出（目前只有静默执行
      // 一处）：默认 undefined 即蓝色，不改变其它所有开关。
      function switchControl(checked, onChange, ariaLabel, disabled, tone) {
        return React.createElement("label", { className: tone === "silent" ? "ldv-switch ldv-switch-silent" : "ldv-switch" },
          React.createElement("input", {
            type: "checkbox",
            checked: !!checked,
            disabled: !!disabled,
            "aria-label": ariaLabel,
            onChange: onChange
          }),
          React.createElement("span", { className: "ldv-switch-track", "aria-hidden": "true" })
        );
      }
      return React.createElement("section", { className: "ldv-settings" },
        // ── 服务与入口（Web 呈现）──────────────────────────────────────────
        // 卡头 = 图标 + 组名 + 状态读数。**总开关已撤除**（Human 2026-11-13 晚）：
        // 「启用 LDVH Web 呈现」这枚 master 与它下面两项投放说的是同一件事，
        // 多一层总闸只会多一种「关着但看不出来为什么」的状态。
        React.createElement("section", { className: "ldv-block" },
          cardHead("services", "group.services", "row.webHint",
            serviceStatus,
            null
          ),
          React.createElement("div", { className: "ldv-block-body" },
            // 故障说明：只在探测失败时出现一次（同一张卡里不另开一个红框），
            // 位置在卡内第一行、各项之上。
            //
            // 存量关闭值优先：`webEnabled: false` 时服务端根本不挂路由，此时
            // 探测失败是**后果**不是故障，说明也只该有一条——故两种情形互斥。
            !webOn
              ? React.createElement("span", { className: "ldv-settings-hint" }, t("row.webDisabledNote"))
              : (serviceIssue ? React.createElement("span", { className: "ldv-settings-hint" }, serviceIssue) : null),
            // 两项投放各自独立（总闸已撤除）。若 profile 里仍写着
            // `webEnabled: false`，这两项**显示为禁用**——服务端确实不挂路由，
            // 让它们照常可点就是让读数说谎。
            settingRow("row.mountConversationTab", null, switchControl(
              webOn && convTabState[0],
              function (e) { convTabState[1](e.target.checked); markDirty(); },
              t("row.mountConversationTab"),
              !webOn
            )),
            settingRow("row.mountSidebarTab", null, switchControl(
              webOn && sidebarTabState[0],
              function (e) { sidebarTabState[1](e.target.checked); markDirty(); },
              t("row.mountSidebarTab"),
              !webOn
            )),
            React.createElement("span", { className: "ldv-note" }, React.createElement("span", { className: "ldv-note-text" }, emphasis(t("row.mountHint"))))
          )
        ),
        // ── 闲时派发（04 §8.1 空闲维护与反思；32 §10）──────────────────
        //
        // **总开关已撤除**（Human 2026-11-13 晚）：子项（闲置捕获 / 闲置审核）
        // 本来就能各自关掉，再套一层总闸等于同一件事有三种关法；总闸关着时
        // 子项整块消失，读者还会以为「这些设置根本不存在」。现在子项恒在，
        // 关哪个就只看哪个。
        React.createElement("section", { className: "ldv-block" },
          cardHead("idle", "group.idle", "row.idleAssistHint", null, null),
          React.createElement("div", { className: "ldv-block-body" },
            // 存量关闭值（`idleAssistEnabled: false`）时给出出口：开关已不在设置面，
            // 不说清去哪儿改，用户就只剩一个关不回来的死角。
            !idleOn ? React.createElement("span", { className: "ldv-settings-hint" }, t("row.idleDisabledNote")) : null,
            // **2026-10-30 合并为两项**（Human 决定）：闲置捕获（发现层：摩擦发现 +
            // 经验捕获，只写缓冲）与闲置审核（审核层：经验审核 + 摩擦缓冲升级，
            // 把缓冲升级为事实对象）。同层任务合并的理由见 index.js 的 schema 注释。
            //
            // 容量维护与记忆健康体检不再出现在设置面：它们在 §8 里仍是登记在册但
            // **未实现**的职责，没有执行体可开关。§8.5「已启用但未实现须如实登记」
            // 由登记表的 `UNIMPLEMENTED_AUX_TASKS` 承载，不由设置面承载。
            [
              { key: "idleCaptureEnabled", state: idleCaptureState, label: "row.idleCapture", hint: "row.idleCaptureHint" },
              { key: "auxReviewEnabled", state: idleReviewState, label: "row.auxReview", hint: "row.auxReviewHint" }
            ].map(function (task) {
              // 这两项**恒渲染**（总闸已撤除）；若 profile 里仍写着
              // `idleAssistEnabled: false`，它们显示为禁用——服务端确实不派发，
              // 让它们照常可点就是让读数说谎。
              // 版面上与组内其他项同构——**不分级**（2026-11-13 Human 定）。
              return settingRow(task.label, task.hint, switchControl(
                idleOn && task.state[0],
                function (e) { task.state[1](e.target.checked); markDirty(); },
                t(task.label),
                !idleOn
              ));
            }),
            // 数值参数：**直接展示、不折叠**（Human 2026-10-14：这是唯一一个参数，
            // 收进 <details> 只会多一次点击，且「藏起来」与「只有一个」相矛盾）。
            // 标签与输入框**同一行**（标签在左、输入框在右），行下紧跟一句解释——
            // 解释须自足，使 Human 不必回读规范就知道这个数在控制什么。
            IDLE_LIMITS.map(function (limit) {
              var invalid = !idleLimitOkFor(limit.key, idleLimitsState[0][limit.key]);
              return React.createElement("div", { key: limit.key, className: "ldv-row" },
                React.createElement("div", { className: "ldv-row-head" },
                  React.createElement("span", { className: "ldv-row-title" }, t("row." + limit.key)),
                  React.createElement("span", { className: "ldv-row-control" },
                    React.createElement("input", {
                      type: "number",
                      step: "1",
                      min: "1",
                      inputMode: "numeric",
                      className: "ldv-settings-input ldv-field-input",
                      value: idleLimitsState[0][limit.key],
                      "aria-invalid": invalid,
                      "aria-label": t("row." + limit.key),
                      onChange: function (e) {
                        var next = {};
                        Object.keys(idleLimitsState[0]).forEach(function (k) { next[k] = idleLimitsState[0][k]; });
                        next[limit.key] = e.target.value;
                        idleLimitsState[1](next);
                        markDirty();
                      }
                    })
                  )
                ),
                limit.hintKey ? React.createElement("span", { className: "ldv-row-desc" }, emphasis(t(limit.hintKey))) : null,
                invalid ? React.createElement("span", { className: "ldv-field-invalid" }, t("row.idleLimitInvalid")) : null
              );
            }),
            // ── 审核执行体的模型（2026-10-26 Human 要求）──────────────────────
            //
            // **审核模型设置已整体移除**（2026-10-27 Human 要求）。该设置从未真正生效：
            // 设置面能填能存，审核执行体却一直按默认路由跑（诊断长期显示
            // `model: (default route)`）。一个「设了不生效」的选项比没有更糟——
            // 它让人以为审核用的是自己挑的模型。故整块去掉，审核固定跟随宿主默认路由。
            //
            // 原块含：一行三列的 Provider/Model/推理强度下拉、模型目录的异步有界
            // 重试、以及「目录为空」的如实提示。全部随该设置一并移除。
            //
            // **2026-10-14（Human 指示）：本节原另有两句提示词条——
            //   ① 「编辑后需点保存生效。填大于 0 的整数」
            //   ② 「安静时长的数值属实现侧承接（11 §6.1）……不得据此主张规范已规定该时长」
            // 两句均已删除。**理由**：① 属可由界面自明的操作提示——改动后由「保存」
            // 按钮自身的状态（见下方 footer）表达，不必另占一行文字；② 是对 AI/读者
            // 的**规范地位声明**，不是给设置的人的提示，放在设置界面上属错置——它
            // 该留在代码注释与规范正文里（11 §6.1 与 idle-settings.js 均已写明）。
            // 删除不减少任何保障：**非法值仍在保存时被拒**（`idleSilenceOk` 的
            // 行内错误提示保留），规范地位的声明仍在规范与代码注释中。
            //
            // **召回预算档位**已独立成卡（见下方「召回预算」一节）：它约束的是
            // 任何行动前的注入量，与闲时派发无关，挂在闲时那张卡里既名不副实，
            // 又让「关掉闲时辅助就看不到预算档位」。**2026-11-13 晚起恒可见**
            //（总闸撤除后没有「关掉闲时辅助」这回事了）。
          )
        ),
        // ── 召回预算 ────────────────────────────────────────────────────
        //
        // **召回预算档位**（Human 决定 2026-10-25）：下拉选择而非自由输入
        // ——档位集合是受控常量（`10 §5.3`「预算的承载形态」），任意数值会让
        // 审计无法确定当时生效的是哪一版。选择本身属 Human 决定，落在
        // profile 配置；提高上限（改档位集合）须走受控提交。
        React.createElement("section", { className: "ldv-block" },
          cardHead("budget", "group.budget", null, null, null),
          React.createElement("div", { className: "ldv-block-body" },
            React.createElement("div", { className: "ldv-row" },
              React.createElement("div", { className: "ldv-row-head" },
                React.createElement("span", { className: "ldv-row-title" }, t("row.injectionBudgetTier")),
                // 下拉自带一枚自绘的折角箭头（.ldv-select）：宿主原生箭头在
                // appearance:none 下会消失，档位框看上去与输入框无异。
                React.createElement("span", { className: "ldv-row-control ldv-select" },
                  React.createElement("select", {
                    className: "ldv-settings-input ldv-field-select",
                    value: String(injectionBudgetState[0]),
                    "aria-label": t("row.injectionBudgetTier"),
                    onChange: function (e) {
                      injectionBudgetState[1](Number(e.target.value));
                      markDirty();
                    }
                  },
                    INJECTION_BUDGET_TIER_OPTIONS.map(function (tier) {
                      return React.createElement("option", { key: String(tier), value: String(tier) }, String(tier) + " K");
                    })
                  )
                )
              ),
              React.createElement("span", { className: "ldv-row-desc" }, emphasis(t("row.injectionBudgetTierHint"))),
              injectionBudgetTierOk(injectionBudgetState[0])
                ? null
                : React.createElement("span", { className: "ldv-field-invalid" }, t("row.idleLimitInvalid"))
            )
          )
        ),
        // ── 把关请示（2026-11-13 Human 决定；同日晚改标题与删说明）────────
        //
        // 保留两项把关，落到两处询问上：动手前问「要不要安排代理
        // 审查」、收口前问「要不要安排代理复核」。**两个独立开关、缺省都关**
        // ——Human 原话「打开才有，否则就是不安排审核与复核」。
        //
        // 为什么不做成「总开关 + 子项」：两处询问在时点与语义上都独立（一个管
        // 动手前、一个管收口前），只想要事前把关的人不该被迫连事后复核一起开。
        // 这与闲时辅助那一块**不同**——那块管同一次派发，拆开会产生半套材料。
        //
        // **2026-11-13 晚（Human 指示）**：组名由「两处把关询问」改为
        // **「把关请示」**（与规范里的系统名一致），并删去组说明与判据旁注
        // ——两段都以「specs/04 §6.1」为主语，
        // 讲的是**机制的来历**而不是**这两项怎么用**；来历在规范与代码注释里，
        // 设置面只需要两项各自的那句话（`row.reviewAskPre/PostHint` 一字未动）。
        // 随之删除两个词条 `row.reviewAskHint` / `row.reviewAskCriteria`（中英各一份），
        // 不留死词条。
        React.createElement("section", { className: "ldv-block" },
          cardHead("review", "row.reviewAsk", null, null, null),
          React.createElement("div", { className: "ldv-block-body" },
            [
              { key: "preActionReviewAskEnabled", state: preActionReviewState, label: "row.reviewAskPre", hint: "row.reviewAskPreHint" },
              { key: "postWorkReviewAskEnabled", state: postWorkReviewState, label: "row.reviewAskPost", hint: "row.reviewAskPostHint" }
            ].map(function (item) {
              return settingRow(item.label, item.hint, switchControl(
                item.state[0],
                function (e) { item.state[1](e.target.checked); markDirty(); },
                t(item.label)
              ));
            }),
            // ── 静默执行（2026-11-13 晚 Human 确认 A1）─────────────────────
            //
            // **不是第三处把关，是上面两项的执行档位**：它回答的是「到点要问
            // 还是直接做」，所以排在两处请示**之下**，而不是与之并列。
            //
            // **为什么轨道用琥珀色**：本页的蓝是**有语义的**——`--ldv-accent`
            // 蓝只表示「这一项开着」（见 CSS 开关段）。这枚开关开着意味着
            // 「不再问你」，若同色，扫视一页蓝点会读成「又多了一处把关」，
            // 与它实际做的事正好相反。琥珀是本页唯一新增的颜色角色。
            //
            // **为什么颜色不是唯一载体**（07 §12 第 8 条）：色觉差异下琥珀与
            // 蓝未必可分，故行标题旁另挂一枚「静默」药丸（文字），说明段也
            // 写明了后果。颜色只加速识别，不单独承载语义。
            settingRow("row.reviewAskSilent", "row.reviewAskSilentHint",
              React.createElement("span", { className: "ldv-silent-control" },
                React.createElement("span", { className: "ldv-silent-badge" }, t("row.reviewAskSilentBadge")),
                switchControl(
                  reviewSilentState[0],
                  function (e) { reviewSilentState[1](e.target.checked); markDirty(); },
                  t("row.reviewAskSilent"),
                  false,
                  "silent"
                )
              )
            )
          )
        ),
        // ── 管辖项目 ──────────────────────────────────────────────────────
        React.createElement("section", { className: "ldv-block" },
          React.createElement("div", { className: "ldv-block-head" },
            React.createElement("span", { className: "ldv-block-icon", "aria-hidden": "true" }, blockIcon("projects")),
            React.createElement("span", { className: "ldv-block-title-line" },
              React.createElement("span", { className: "ldv-block-title" }, t("row.projectsPanelTitle")),
              !projectsState[0].loading && projectsState[0].value
                ? React.createElement("span", { className: "ldv-count" }, String((projectsState[0].value.projects || []).length))
                : null
            ),
            React.createElement("span", { className: "ldv-block-control ldv-block-action" },
              React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0] || addingState[0], onClick: openAddForm }, t("row.addProject"))
            )
          ),
          React.createElement("div", { className: "ldv-block-body" },
            addingState[0]
              ? React.createElement("div", { className: "ldv-governance-add" },
                  React.createElement("div", { className: "ldv-governance-add-head" },
                    React.createElement("span", { className: "ldv-governance-add-icon", "aria-hidden": "true" }, "+"),
                    React.createElement("span", { className: "ldv-governance-add-copy" },
                      React.createElement("span", { className: "ldv-governance-add-title" }, t("row.addProjectTitle")),
                      React.createElement("span", { className: "ldv-governance-add-hint" }, t("row.addProjectHint"))
                    )
                  ),
                  React.createElement("div", { className: "ldv-governance-add-fields" },
                    React.createElement("div", { className: "ldv-governance-add-field" },
                      React.createElement("span", { className: "ldv-governance-add-label" }, t("row.projectPath")),
                      React.createElement("span", { className: "ldv-governance-path-control" },
                        React.createElement("input", { className: "ldv-settings-input", value: candidateState[0].path, disabled: projectBusyState[0], "aria-label": t("row.projectPath"), placeholder: t("row.projectPath"), onChange: function (event) { candidateState[1]({ path: event.target.value, id: candidateState[0].id }); } }),
                        React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: chooseProject }, t("row.chooseProject"))
                      )
                    ),
                    React.createElement("div", { className: "ldv-governance-add-field" },
                      React.createElement("span", { className: "ldv-governance-add-label" }, t("row.projectId")),
                      React.createElement("input", { className: idInputClass, value: candidateState[0].id, disabled: projectBusyState[0], "aria-invalid": idError && idError !== "required" ? "true" : "false", placeholder: t("row.projectId"), onChange: function (event) { candidateState[1]({ path: candidateState[0].path, id: event.target.value }); } }),
                      React.createElement("span", { className: "ldv-governance-add-field-help" }, t("row.projectIdHelp")),
                      idErrorText
                        ? React.createElement("span", { className: "ldv-governance-add-field-error", role: "alert" }, idErrorText)
                        : null
                    )
                  ),
                  installErrorState[0]
                    ? React.createElement("div", { className: "ldv-governance-add-error", role: "alert" }, installErrorState[0])
                    : null,
                  React.createElement("div", { className: "ldv-governance-add-actions" },
                    React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: closeAddForm }, t("row.cancelAdd")),
                    React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: installBlocked, onClick: installCandidate }, projectBusyState[0] ? t("row.installBusy") : t("row.install"))
                  )
                )
              : null,
            projectRows
          ),
          // 登记位置说明：放在这一块的末尾（而不是块首），读的人先看到「有哪些
          // 项目」，再看到「存在哪儿」——与读序一致。
          React.createElement("span", { className: "ldv-note" },
            React.createElement("span", { className: "ldv-note-title" }, t("row.governanceLocation")),
            React.createElement("span", { className: "ldv-note-text" }, t("row.governanceLocationHint"))
          )
        ),
        React.createElement("div", { className: "ldv-settings-footer" },
          // 页脚左侧：“鼓励一下 ★”链接（GitHub 仓库，同族插件一致的曝光位）
          // + 保存状态；右侧保持“放弃修改 / 保存”按钮。
          React.createElement("div", { className: "ldv-settings-footer-left" },
            React.createElement("a", {
              className: "ldv-settings-cheer",
              href: LDVH_GITHUB_URL,
              target: "_blank",
              rel: "noopener noreferrer"
            },
              t("row.cheer"),
              React.createElement("span", { className: "ldv-settings-cheer-star", "aria-hidden": "true" }, "\u2605")
            ),
            savedState[0]
              ? React.createElement("span", { className: "ldv-settings-footer-status" }, t("row.saved"))
              : (saveErrorState[0] ? React.createElement("span", { className: "ldv-settings-footer-error", role: "alert" }, t("row.saveFailed") + (saveErrorDetailState[0] ? " " + saveErrorDetailState[0] : "")) : null)
          ),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: !dirtyState[0] || busyState[0], onClick: discard }, t("row.discard")),
          // **保存按钮自身承载「有未保存改动」这一状态**（2026-10-14，Human 指示：
          // 「修改后需要保存按钮显示为需要保存」）。原设计只靠一行文字提示
          // （「编辑后需点保存生效」，已删）——文字要读者先看见才起作用，而按钮
          // 是**操作发生处**，状态就该落在那里。
          //
          // 三重表达（不只靠颜色：色觉障碍与高对比主题下颜色可能不可辨）：
          //   ① 文案由「保存」变为「保存改动」；② 加 `ldv-btn-dirty` 类（描边与
          //   字重变化）；③ `aria-label` 明确写出「有未保存的更改」，供读屏。
          // `disabled` 仍为 `saveDisabled`（含 !dirty），故**无改动时按钮不可点**，
          // 状态与可操作性一致——不会出现「按钮亮着但点了没反应」。
          React.createElement("button", {
            type: "button",
            className: dirtyState[0] ? "ldv-btn ldv-btn-primary ldv-btn-dirty" : "ldv-btn ldv-btn-primary",
            disabled: saveDisabled,
            onClick: save,
            "aria-label": busyState[0] ? t("row.saving") : (dirtyState[0] ? t("row.saveDirtyAria") : t("row.save"))
          }, busyState[0] ? t("row.saving") : (dirtyState[0] ? t("row.saveDirty") : t("row.save")))
        ),
        toastState[0] ? React.createElement(Toast, { key: toastState[0].seq, text: toastState[0].text, onDone: function () { toastState[1](null); } }) : null
      );
    }

    // ── 设置卡组件已删除（Human 2026-11-13）────────────────────────────
    //
    // 原 `LdvhSettingsCard` 是 Plugins 页 keyed 槽位（plugins.bundle.config /
    // plugins.row.config）的折叠卡片：自带图标 + 标题 + 展开箭头。
    //
    // 那两个槽位撤除后（同一份配置不得有两个编辑入口，见 apply 里的说明），
    // 它再无任何引用。**按「不留未引用代码」的纪律当场删除**，而不是留着等
    // 「以后可能用得上」——本仓已多次因残留代码被误读（注释说还在用、实际
    // 早已无调用方）。若宿主日后恢复 keyed 配置槽位，重建它比维护一份没人
    // 验证的死代码便宜。
    //
    // 相关样式（.ldv-settings-card* 一组）**一并删除**：它们只为那张卡存在，
    // 没有卡片就没有元素带这些类名。留着不是「几行无害的文本」，而是让后续
    // 读者以为还有卡片在用它们（本仓已多次因这种残影误判）。
    // 唯一被保留断言的是 `.ldv-settings-card*` 里的**外观契约**记录——那条
    // 现在改为断言「这些类名不应再出现在源码里」。

    /**
     * betterSidebar「LDVH」tab：iframe 加载 /ldvh（与 LdvhConversationView
     * 同一健康检查/降级模式——Web 路由未挂载时给说明与重试，不给破 iframe）。
     * 沙箱说明：better-sidebar 对与 GUI 同源的页面强制不透明源沙箱（无
     * allow-same-origin），Web 侧已给 localStorage 加守卫（useTheme），
     * API 走相对路径 fetch 不受沙箱影响。
     */
    // iframe 位置记忆：better-sidebar 切 tab 会重挂内容组件（visible 翻转使
    // TabContent memo 失效），iframe 重建即回 /ldvh/ 主页。Web 应用侧路由变化
    // postMessage 通知（沙箱允许 postMessage），模块级变量在组件重挂间保留，
    // 重建的 iframe 以记忆路径为初始 src——用户停留的页面不再丢失。
    //
    // 地址形状（2026-09-25 修订）：iframe 必须指向插件自带 Web 服务的**绝对
    // 回环地址**，不能用相对路径 `/ldvh/`。
    //
    // 原因（DevTools 运行时取证）：主窗口文档的源是 `dsh-app://app`，相对路径
    // `/ldvh/` 因此解析为 `dsh-app://app/ldvh/`，走宿主转发链。而宿主只在
    // `request.frame === owner.mainFrame` 时注入身份头 `x-dsh-desktop-renderer`
    // （宿主 lib/web-document.js:20 的 appRequestHeaders）——iframe 是**子框架**，
    // 拿不到该头，宿主 forwardWebRequest 遂判 403。实测报错：
    //   GET dsh-app://app/ldvh/ 403 (Forbidden)
    //
    // 插件自带的 Web 服务（见 lib/index.js 的 WEB_API_PORT）监听固定回环端口，
    // 不经 dsh-app 转发链，故在其上同时服务 SPA 与 /ldvh/api 别名后，iframe 走
    // 该绝对地址即可绕开子框架判据。
    // 测试环境（无 window）守卫：模块加载期不炸，宿主正常注册。
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("message", function (event) {
      if (event.source === window) return;
      var data = event.data;
      if (data && typeof data === "object" && data.type === "ldvh:navigate" && typeof data.pathname === "string") {
        if (data.pathname.indexOf("/ldvh") === 0) {
          ldvhFrameLocation = ldvhWebOrigin + data.pathname;
          // 路径归属随消息报上来（Web 侧自己知道当前选中的项目）：缺字段时记
          // null，即「归属未知」——下一次判定按跨项目处理、落回首页，宁可少
          // 沿用一次深链，也不要把人带进别的项目里的死路。
          ldvhFrameProjectId = typeof data.projectId === "string" && data.projectId.length > 0 ? data.projectId : null;
        }
      }
    });

    // ── 会话跟随（07 §7，Human 裁定 2026-10-29）──────────────────────────
    //
    // 诉求：多项目并行时「当前会话是哪个项目，打开的就是哪个项目」，不再手切。
    //
    // **判据来自既有唯一职责，不在客户端另解析路径**：/ldvh/state/governance
    // 以 sessionId 答出该会话所属管辖项目（管辖判定见 08 §5；该端点 always-on，
    // 不受 Web 呈现开关影响）。客户端只消费它给出的 project.id。
    //
    // **只在项目变化时换页**：同项目切换会话时 src 逐字不变（返回同一 state
    // 对象，React 短路重渲染），iframe 不重载，用户正在阅读的详情不丢——这是
    // Human 裁定的第二条，也是本段复杂度的来源。
    //
    // **失败一律不猜**：会话标识缺失、端点不可达、state 非 governed（含
    // unknown / not_governed / unavailable）都回 null，地址不带项目参数，
    // Web 侧沿用自身既有选择链（localStorage + defaultProjectId）。
    //
    // **跨项目不沿用记忆路径**：`ldvhFrameLocation` 记的是页面内深链接，而对象
    // 引用是项目内的——带着 A 项目的详情路径开 B 项目只会得到「对象不存在」，
    // 那不是跟随而是把人带进死路。故记忆路径的**归属**由 Web 侧随 postMessage
    // 报上来（见 RouteMemoryReporter），只在归属与当前会话项目一致时沿用，
    // 换了项目就落回该项目首页。
    var LDVH_PROJECT_PARAM = "ldvhProject";
    var LDVH_HOME_PATH = "/ldvh/";
    /** 记忆路径所属项目 id；null = 不知道归属（此时只在换项目时回首页）。 */
    var ldvhFrameProjectId = null;

    /** 管辖判定的单次询问：非 governed、应答畸形、传输失败一律回 null（不猜）。 */
    function askGovernanceProject(query) {
      return fetch("/ldvh/state/governance?" + query, { method: "GET", cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (body) {
          if (!body || body.state !== "governed") return null;
          var project = body.project;
          if (!project || typeof project.id !== "string" || project.id.length === 0) return null;
          return project.id;
        })
        .catch(function () { return null; });
    }

    /**
     * 当前会话所属管辖项目 id；两条询问都判不出即 null。
     *
     * **为什么问两次**：判定入口有两种输入形态（sessionId / cwd），而侧栏给的
     * 会话标识与判定表所记的会话标识须落在同一 id 空间才有答案——不一致时端点
     * 如实回 `unknown`（这是它的 fail-closed 设计，不猜）。只问 sessionId 的话，
     * 口径一错整条跟随就静默失效：页面照样开，项目照样不对，也不报任何错，
     * 正是 Human 抱怨的「会乱」。故 sessionId 判不出时，改用同一判定职责问 cwd。
     *
     * 两次询问都是**同一个管辖判定职责**（08 §5），客户端始终不自行解析路径、
     * 不读登记载体、不推断管辖状态。
     */
    function resolveSessionProject(sessionId, cwd) {
      var sessionQuery = typeof sessionId === "string" && sessionId.length > 0
        ? "sessionId=" + encodeURIComponent(sessionId)
        : "";
      var cwdQuery = typeof cwd === "string" && cwd.length > 0
        ? "cwd=" + encodeURIComponent(cwd)
        : "";
      if (sessionQuery === "") {
        // 只有 cwd 可用（对话视图只给 sessionId，侧栏两者都可能给）。
        return cwdQuery === "" ? Promise.resolve(null) : askGovernanceProject(cwdQuery);
      }
      return askGovernanceProject(sessionQuery).then(function (bySession) {
        if (bySession !== null) return bySession;
        return cwdQuery === "" ? null : askGovernanceProject(cwdQuery);
      });
    }

    /** 把项目参数拼进 iframe 地址，保留路径与其余查询；null 项目即原样返回。 */
    function withProjectParam(location, projectId) {
      if (!projectId) return location;
      var hashIndex = location.indexOf("#");
      var hash = hashIndex >= 0 ? location.slice(hashIndex) : "";
      var base = hashIndex >= 0 ? location.slice(0, hashIndex) : location;
      var queryIndex = base.indexOf("?");
      var path = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
      var query = queryIndex >= 0 ? base.slice(queryIndex + 1) : "";
      // 同名参数整对替换：追加两份会让 Web 侧读到陈旧的前一个值。
      var kept = query.length === 0 ? [] : query.split("&").filter(function (pair) {
        return pair.split("=")[0] !== LDVH_PROJECT_PARAM;
      });
      kept.push(LDVH_PROJECT_PARAM + "=" + encodeURIComponent(projectId));
      return path + "?" + kept.join("&") + hash;
    }

    /**
     * 拼一次地址：记忆路径属于本项目就沿用（保住用户停留的深链接），否则回首页。
     *
     * 只在**判定回话那一刻**调用，结果存进 state 供后续渲染直读。不能在 render
     * 里现拼：`ldvhFrameLocation` 会被 Web 侧的 postMessage 随时改写（用户页内
     * 导航），现拼等于「页内导航后一旦有无关重渲染，src 就变了」，React 见 src
     * 变化即重载文档——正是「停在详情页时被莫名弹走」。存下字符串后，同项目
     * 切换会话返回原 state，React 不动 iframe 属性。
     */
    function composeFollowedLocation(projectId) {
      if (projectId === null) return ldvhFrameLocation;
      if (ldvhFrameProjectId === projectId) return withProjectParam(ldvhFrameLocation, projectId);
      // 记忆路径属于别的项目：带着它开新项目只会落到「对象不存在」的死路。
      return withProjectParam(ldvhWebOrigin + LDVH_HOME_PATH, projectId);
    }

    /**
     * 当前会话的项目跟随地址。
     *
     * 返回 `{ following, src }`：`following` 为 false 表示判定尚未回话（首帧不
     * 渲染 iframe，避免先以无项目地址加载、回话后再整页重载——每开一次都白闪
     * 一次，正是本段要消掉的抖动）。
     */
    function useFollowedFrameLocation(sessionId, cwd) {
      // null = 判定未回话；否则 { projectId, src }。
      //
      // **state 里只记 project.id，不记 sessionId**：判据是「项目变没变」，不是
      // 「会话变没变」。把 sessionId 也拿来比较会在同项目切会话时重算 src——
      // 而此刻 `ldvhFrameLocation` 已被页内导航的 postMessage 改写，重算出的
      // 字符串与旧 prop 不同，React 遂更新 src 属性、iframe 重新载入文档，
      // 正是 Human 裁定第二条明令禁止的换页。只比项目 id 时同项目返回原对象，
      // prop 逐字不变，页面原地保留。
      var frameState = React.useState(null);
      React.useEffect(function () {
        var cancelled = false;
        resolveSessionProject(sessionId, cwd).then(function (projectId) {
          if (cancelled) return;
          frameState[1](function (previous) {
            // 同项目（含两次都判不出）返回同一对象：src 逐字不变，React 不动
            // iframe 属性，页面不重载——Human 裁定的「仅项目变化才换页」。
            if (previous !== null && previous.projectId === projectId) return previous;
            // **判不出项目时不改指**（§8「跟随判据不可得」行的「保持当前呈现」）：
            // 已呈现某项目后切到一个判不出归属的会话，若按 null 重拼地址就会**丢掉
            // 项目参数**——iframe 随之重载，Web 回落到自身选择链（记忆里的项目），
            // 结果呈现的可能是第三个项目。那不是「跟随不生效」，是被一次判不出把人
            // 从当前项目带走。故沿用原 src：跟随不生效，呈现不动。
            if (previous !== null && projectId === null) return previous;
            return { projectId: projectId, src: composeFollowedLocation(projectId) };
          });
        });
        return function () { cancelled = true; };
      }, [sessionId, cwd]);
      var resolved = frameState[0];
      if (resolved === null) return { following: false, src: ldvhFrameLocation };
      return { following: true, src: resolved.src };
    }

    function LdvhSidebarTab(props) {
      var t = props.t;
      var sessionScope = props.scope;
      var sessionId = sessionScope && typeof sessionScope.sessionId === "string" ? sessionScope.sessionId : "";
      var sessionCwd = sessionScope && typeof sessionScope.cwd === "string" ? sessionScope.cwd : "";
      var followed = useFollowedFrameLocation(sessionId, sessionCwd);
      var viewState = React.useState({ checking: true, ready: false, failed: false });
      React.useEffect(function () {
        var cancelled = false;
        checkHealth(function (ok) {
          if (cancelled) return;
          viewState[1](ok ? { checking: false, ready: true, failed: false } : { checking: false, ready: false, failed: true });
        });
        return function () { cancelled = true; };
      }, []);
      function retry() {
        viewState[1]({ checking: true, ready: false, failed: false });
        checkHealth(function (ok) {
          viewState[1](ok ? { checking: false, ready: true, failed: false } : { checking: false, ready: false, failed: true });
        });
      }
      var state = viewState[0];
      var body = null;
      if (state.checking || !followed.following) {
        body = React.createElement("div", { className: "ldv-view-state" },
          React.createElement("p", null, t("view.loading"))
        );
      } else if (state.failed) {
        body = React.createElement("div", { className: "ldv-view-state" },
          React.createElement("p", null, t("view.error")),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", onClick: retry }, t("view.retry"))
        );
      } else {
        body = React.createElement("iframe", {
          className: "ldv-view-frame",
          src: followed.src,
          title: t("sidebar.title")
        });
      }
      return React.createElement("div", { className: "ldv-view" }, body);
    }

    function LdvhConversationView(props) {
      var t = props.t;
      var sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
      var followed = useFollowedFrameLocation(sessionId);
      var viewState = React.useState({ checking: true, ready: false, failed: false });
      React.useEffect(function () {
        var cancelled = false;
        checkHealth(function (ok) {
          if (cancelled) return;
          viewState[1](ok ? { checking: false, ready: true, failed: false } : { checking: false, ready: false, failed: true });
        });
        return function () { cancelled = true; };
      }, []);
      function retry() {
        viewState[1]({ checking: true, ready: false, failed: false });
        checkHealth(function (ok) {
          viewState[1](ok ? { checking: false, ready: true, failed: false } : { checking: false, ready: false, failed: true });
        });
      }
      var state = viewState[0];
      var body = null;
      if (state.checking || !followed.following) {
        body = React.createElement("div", { className: "ldv-view-state" },
          React.createElement("p", null, t("view.loading"))
        );
      } else if (state.failed) {
        body = React.createElement("div", { className: "ldv-view-state" },
          React.createElement("p", null, t("view.error")),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", onClick: retry }, t("view.retry"))
        );
      } else {
        body = React.createElement("iframe", {
          className: "ldv-view-frame",
          src: followed.src,
          title: t("view.label")
        });
      }
      return React.createElement("div", { className: "ldv-view" }, body);
    }

    // ── apply: inject the contributions ──────────────────────────────────
    // settingsScope 已从 DSH 0.1.7 删除（调研 §3.3），因此不再列入硬注入——
    // 留在 inject 里会让整个客户端插件永不 apply（服务永远等不到）。替代品
    // configForms 走 ctx.inject 软注入：缺失时设置卡不注册，插件照常工作。
    //
    // `uiConversation` 已于 2026-11-13 退出硬注入清单（宿主 0.2.2-rc.2 适配）：
    // 它此前只服务于自建的管辖判定行（`ldvh-notice` 节点 kind），而该行随宿主
    // 撤除 context 可见性排除而一并撤除——现在这条注入由宿主原生
    // `ContextInjectionRow` 承载，插件不再需要事件注册表。**不要因为「以后可能
    // 用得上」把它加回来**：硬注入缺一即整个客户端插件永不 apply，代价是该插件
    // 的全部界面消失，而收益为零。
    var inject = ["slots", "locale"];

    function apply(ctx) {
      try {
        ctx.effect(function () {
          return ctx.locale.register(LDVH_NS, { zh: LDVH_ZH, en: LDVH_EN });
        }, "dsh-ldvh: settings copy");

        var t = ctx.locale.bind(LDVH_NS);

        // ── 设置面（0.1.7 起）────────────────────────────────────────────
        // 旧：ctx.settingsScope.bind({namespace}) → scope.set(key, value)；
        // 新：ctx.configForms.get(<entry id>) → SettingsFormScope，读法不变
        // （getSnapshot / subscribe），写改为一次带 revision fence 的 mutate。
        // 条目 id 取宿主实际服务的那个（ldvhEntryIdOf 探测，桌面宿主为
        // `include:dsh-ldvh`——硬编码短名会绑定到无人服务的命名空间）。
        ctx.inject(["configForms"], function (formsCtx) {
          var ldvhScope = formsCtx.configForms.get(ldvhEntryIdOf(formsCtx.configForms));
          // ── Plugins 页的两个 keyed 槽位**已撤除**（Human 2026-11-13）──────
          //
          // 原先在此注册 `plugins.bundle.config`（key = 包名）与
          // `plugins.row.config`（key = `<包名>#<行 id>`），与 dsh-connect-workbuddy
          // 旧版同款。现整体撤除，对照 workbuddy 5.19.0 的做法——它的注释写得
          // 明确：**「同一份配置不得有两个编辑入口」**（the same configuration
          // must not have two editing entries）。
          //
          // 撤除的三条依据（不是审美偏好）：
          //   1. **双入口必然漂移**：两个入口读同一份 Config，但各自的本地 state、
          //      脏标记与 revision fence 互不可见。在 A 处改、B 处仍显旧值，用户
          //      不知道该信哪个——本仓已因「设置面显示与实际生效不一致」踩过坑。
          //   2. **keyed 槽位的寻址脆弱**：按包名/行 id 精确匹配宿主清单，插件被以
          //      不同 Loader 条目 id 挂载时得注册两种拼写，漏一种就**整块不渲染且
          //      不报错**（workbuddy issue #55）。设置页的 `settings.section` 用本
          //      插件自有的 id，没有这个问题。
          //   3. **Human 的诉求就是一处**：「把 ldvh 的设置也放到设置里」——所有
          //      偏好集中在一处，而不是插件详情里还留一份。
          //
          // 卡片组件 `LdvhSettingsCard` 与其 12 条样式**已一并删除**——撤除槽位后
          // 它再无任何引用。不留「以后可能用得上」的死代码：本仓已多次因残影被
          // 误判（注释说还在用、实际无调用方）。宿主日后若恢复 keyed 配置槽位，
          // 重写一张卡比维护一份没被验证的代码便宜。

          /**
           * 设置页的一节（Human 2026-11-13：「把 ldvh 的设置也放到设置里，
           * 参考 workbuddy 的做法」）。
           *
           * ## 为什么这是**唯一**入口（Plugins 页那两个槽位已撤）
           *
           * 同一份配置不得有两个编辑入口——这是 workbuddy 5.19.0 的原话
           * （the same configuration must not have two editing entries），也是
           * Human 2026-11-13 的要求。双入口的失效形态不是「多一个地方能改」，
           * 而是**两处读写同一份 Config 却各有独立本地 state**：在 A 处改、B 处
           * 仍显示旧值，用户无从判断哪个是真的。撤除细节与依据见上文
           * 「Plugins 页的两个 keyed 槽位已撤除」那段。
           *
           * ## 为什么注册的是 LdvhSettingsRow
           *
           * 设置页由宿主提供面板骨架（标题、关闭按钮都是宿主的）。原卡片
           * `LdvhSettingsCard` 自带折叠头（图标 + 标题 + 展开箭头），那是插件
           * 清单里折叠条目用的外壳；在设置页里再套一层会出现「标题套标题、
           * 箭头套箭头」。故这里注册的是**内容**：`LdvhSettingsRow`。
           *
           * ## 为什么没有能力探测
           *
           * `slots.inject(name, ...)` 本身就是探测——槽位不存在时它什么都不做
           * （不抛、不排队），宿主有了才执行回调。用版本号或服务访问器去预判，
           * 会把「这台宿主不支持」变成「哪儿都不注册」，而后者不报任何错
           * （workbuddy 的注释里记着这个教训）。让宿主回答。
           */
          var registerSettingsSection = function () {
            try {
              return formsCtx.slots.inject("settings.section", function () {
                var disposers = [];
                var sectionInjected = function () {
                  return {
                    t: t,
                    settingsScope: ldvhScope,
                    directoryPicker: ctx.get("remote.directoryPicker"),
                    // 通知卡片「你正处在设置页里」：设置页自己不需要折叠头，
                    // 也不该再画一遍标题（宿主已给）。
                    surface: "settings",
                  };
                };
                disposers.push(formsCtx.slots.register({
                  name: "settings.section",
                  id: LDVH_SETTINGS_SECTION_ID,
                  order: LDVH_SETTINGS_SECTION_ORDER,
                  label: function () { return t("row.title"); },
                  locale: LDVH_NS,
                  inject: sectionInjected,
                }, LdvhSettingsRow));

                // 图标：同一个 id 是唯一的配对凭据。**单独 try/catch**——
                // 页面是功能、图标是装饰；宿主声明了节但没有图标座时，
                // 仍须给出页面（与 workbuddy 同一处置）。
                try {
                  var iconInject = formsCtx.slots.inject("settings.section.icon", function () {
                    var iconDisposer = formsCtx.slots.register({
                      name: "settings.section.icon",
                      id: LDVH_SETTINGS_SECTION_ID,
                      locale: LDVH_NS,
                    }, function (iconProps) {
                      var edge = iconProps && typeof iconProps.size === "number" ? iconProps.size : 16;
                      return React.createElement("img", {
                        src: LDVH_ICON,
                        width: edge,
                        height: edge,
                        alt: "",
                        style: { borderRadius: "4px", display: "block", opacity: iconProps && iconProps.active === false ? 0.75 : 1 }
                      });
                    });
                    disposers.push(iconDisposer);
                    return iconDisposer;
                  });
                  if (typeof iconInject === "function") disposers.push(iconInject);
                } catch (iconError) {
                  console.error('[dsh-ldvh] settings nav icon failed to register (page unaffected):', iconError);
                }

                return function () {
                  for (var i = 0; i < disposers.length; i += 1) {
                    try { disposers[i](); } catch (alreadyGone) { /* 槽位服务已处置 */ }
                  }
                };
              });
            } catch (error) {
              console.error('[dsh-ldvh] settings section failed to register (host provider unaffected):', error);
              return undefined;
            }
          };
          registerSettingsSection();
        });

        // 投放面设置：订阅驱动（apply 时设置服务可能尚未 ready——一次性快照会
        // 静默落到默认全开，Human 实测复选框不生效的根因）。订阅变更流：每次
        // 快照变化重算投放开关并按需重挂/卸挂两个视图；ready 之前的变更静默
        // 等待（未挂载状态没有要撤销的东西，不存在闪烁问题）。
        var mountDisposers = { sidebar: null, conversation: null };
        var registerSidebarTab = function () {
          // 软注入：ctx.inject 订阅服务可用性（apply 时未就绪也会等）——
          // 服务缺失时直接跳过，本插件照常工作。
          var disposeInject = ctx.inject(["betterSidebar"], function (scope) {
            var betterSidebar = scope.betterSidebar;
            if (!betterSidebar || typeof betterSidebar.registerTab !== "function") return;
            var disposeEffect = scope.effect(function () {
              mountDisposers.sidebar = function () {
                try { disposeEffect(); } catch (alreadyGone) { }
              };
              return betterSidebar.registerTab({
                id: "dsh-ldvh:web",
                title: function () { return t("sidebar.label"); },
                icon: function (size) {
                  return React.createElement("img", { src: LDVH_ICON, width: size, height: size, alt: "LDVH", style: { borderRadius: "3px" } });
                },
                order: 35,
                single: true,
                component: function (tabProps) {
                  return React.createElement(LdvhSidebarTab, { t: t, scope: tabProps && tabProps.scope });
                }
              });
            }, "dsh-ldvh: better sidebar tab");
          });
          return function () { try { disposeInject(); } catch (alreadyGone) { } };
        };
        var registerConversationTab = function () {
          var disposeInject = ctx.slots.inject("conversation.view", function () {
            mountDisposers.conversation = function () { try { disposeInject(); } catch (alreadyGone) { } };
            return ctx.slots.register({
              name: "conversation.view",
              id: "ldvh",
              order: 20,
              label: function () { return t("view.label"); },
              inject: function (sessionId) { return { t: t, sessionId: sessionId }; }
            }, LdvhConversationView);
          });
        };

        var applyMountSettings = function (value) {
          var webOn = !value || value.webEnabled !== false;
          var sidebarOn = webOn && value && value.showInSidebarTab !== false;
          var conversationOn = webOn && value && value.showInConversationTab !== false;
          if (sidebarOn && mountDisposers.sidebar === null) {
            registerSidebarTab();
          } else if (!sidebarOn && mountDisposers.sidebar !== null) {
            var offSidebar = mountDisposers.sidebar;
            mountDisposers.sidebar = null;
            try { offSidebar(); } catch (alreadyGone) { }
          }
          if (conversationOn && mountDisposers.conversation === null) {
            registerConversationTab();
          } else if (!conversationOn && mountDisposers.conversation !== null) {
            var offConversation = mountDisposers.conversation;
            mountDisposers.conversation = null;
            try { offConversation(); } catch (alreadyGone) { }
          }
        };

        // 投放面：先按「默认全开」挂上——不依赖任何设置服务在场，因此
        // configForms 缺失（老宿主 / 未装配 ui-settings 的组合）时侧栏 tab
        // 与对话 Tab 仍然可用；有 configForms 时下面的订阅会用真实设置值覆盖。
        applyMountSettings({});

        // 对话流的管辖判定行已交还宿主（2026-11-13，宿主 0.2.2-rc.2 适配）：
        // 宿主 `isVisibleChatNode()` 不再排除普通 Context，本插件此前为绕过该排除
        // 而自建的 `ldvh-notice` 节点 kind 若保留，同一注入会被渲染两遍。故此处
        // **不再注册任何自有行**——`source.form = "notice"` 与 `source.summary`
        // 由宿主 `ContextInjectionRow` 直接呈现（`noticeSummary()` →
        // `data-context-summary`），插件侧零补偿。

        // 订阅设置变更：ready 前静默等待；每次快照变化（含首次 ready）应用投放开关。
        // 挂在 configForms 的子 fiber 上（服务缺失时整块不执行，投放面停在默认全开）。
        ctx.inject(["configForms"], function (formsCtx) {
          var ldvhScope = formsCtx.configForms.get(ldvhEntryIdOf(formsCtx.configForms));
          formsCtx.effect(function () {
            return ldvhScope.subscribe(function () {
              var snap = ldvhScope.getSnapshot();
              if (snap && snap.status === "ready") applyMountSettings(snap.value || {});
            });
          }, "dsh-ldvh: mount placement subscription");
          // apply 时若已 ready（服务先于本插件就绪）立即应用一次。
          try {
            var initialSnap = ldvhScope.getSnapshot();
            if (initialSnap && initialSnap.status === "ready") applyMountSettings(initialSnap.value || {});
          } catch (mountError) { /* 订阅会补上 */ }
        });

      } catch (error) {
        // Match WorkBuddy's browser failure boundary: Host remains functional,
        // developers see the cause, users do not get a page-level red banner.
        console.error("[dsh-ldvh] client UI failed to load (host routes unaffected):", error);
      }
    }

    return { apply: apply, inject: inject };
  }
});