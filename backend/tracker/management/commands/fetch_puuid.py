"""
Management command: fetch_puuid

Resolves every player in the hardcoded list to a PUUID via the Riot Account API
and persists the result in the Player table.

Run this once (or whenever the player list changes):
    python manage.py fetch_puuid

fetch_pbe assumes PUUIDs are already stored and will skip players without one.
"""
import asyncio
import logging
import os

from django.core.management.base import BaseCommand

from tracker.models import Player
from tracker.management.commands._player_utils import parse_player_lines, fetch_accounts_async

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hardcoded player list
# Lines without '#' default to tag_line='pbe'.
# Unicode directional-formatting chars (U+2066 / U+2069) are stripped.
# ---------------------------------------------------------------------------

_TIER1_PLAYERS = """\
sakurazhenbai
sayaovo#233
saopimi#pbe
diaomei8#PBE
60second#1428
ringo#5612
tukuai1 #12138
Flancy#PBE2
ran111#1234
serein#318
AHaoei#pbe
Far3well#PBE
go fly#pbe
丨Karina丨#PBE
Liluomax#6017
bby#pbe
koyui#TFT
cycyds#pbe
xzhizhu#PBE
Lbtz#pbe
houzishangshan#pbe
Qiyue⁦⁩#⁦0113
⁦Redlotus⁩#⁦7934⁩
AGRiyue#323
udhkzvv#PBE
weimu#9444
huyashendu#pbe
sucksuko#pbe
Dishsoap pbe
GD Royal#PBE
FW AQ1H#AQ1H2
DarthNub#PBE11
DR OH#PBE
wasianiversonPBE#pbe
yby1#pbe
Voltariux#PBE
Lab 00 Broseph#PBE
va pa casa#1278
Bossoskills#pbe
tomjdsssss
barley tea#bmk
Deis1k
KRMXPBE
M8 Enzosx
Thinthing#pbe
KR Balmyeong#pbe
PRESTIVENT#PBE
jazlatte#pbe
Angora#pbe
junglebook1#jb1
KRsCsC#PBE
traviscwatt#PBE
WithoutYou#4313
twitch taro jp#PBE
Canbizz61#PBE
seoill#2102
BTS Dylan#2108
rykomastery#pbe
J or C#PBE
Double61PBE#PBE11
Nipple Overdrive#PBE
DavidAcePBE#TFTQC
Opale#2102
Filup #PBE
titletitletitle#pbe
Asta1 PBE#Testd
KR Pengdori#PBE
elephantbisket
Cambulee#PBE
G2 PasDeBol#PDBG2
Gingpbe#pbe
Dalesom#PBE
vomendeth1#PBE
kubixon#pbe
Maladjust#12345
Crescent#xpbe
INPATH#1234
HoroX#226
Gobosteur#PBE
namechange1996#123
Wet JunglerPBE#pbe
JosueDeleted#PBE
RYT Shaco#pbe
bensac#pbe
me1stor8th#PBE2
Bapzera#pbe
Clemou#WTBB
yatsuhashiPBE#pbe
LadderSlayer PBE#PBE
Tomino66#pbe
Hypno#pbe
Binteum#PBE
SheeepStick#PBE
cmbQAQ#4231
ViggoZe#PBE
Kojnid#PBE
Carpe Diem KR#TFT
undake#pbe
Dicob#1401
⁦Yobidashi⁩#⁦1507⁩
m0tiv#pbe
⁦the tristan⁩#⁦PBE⁩
Lilbear#Bear
kaito716#PBE
PBE Kitade
ZyK0o#PBE
mori pbe1
qiqi eht naf #pbe
⁦Oquintaniilha⁩#⁦2729⁩
dehuapbe#pbe
CrazyCatPBE#PBE
Yeso #tw666
M00ritz #PBE
TFT AUG#PBE
TexSummers
IronBogPBE#999
Lyyyress#PBE
RCS Xperion#osp
pepelaugh 2
Tamama#mama
Alegory#GLORP
Maykel TFT PBE#pbe
ssiel#PBE2
pepoglad#pbe

META Sologesang#123
keayser le goat#PBE
MillenniumFoxPBE#TFT1
Safo20#pbe
Sacred Norris312#PBE7
Guillosko#PBE
Chunington#7553
TrybleH#PBE
Agginpbe#mie
Sixyuan#Flash
⁦BangBang⁩#⁦9207⁩
LC Dominus #CAPO
也是很强的了
LIGhtYgo#PBE
NanandePBE#nna
sanchess#pbe
yizhiyize#pbe
Chongqing#pbe
JayLee0#62303
Nafla#1314
maybe one#PBE
Winterc#43210
wbg丶壳子
jason#20040
MidFeed so Bad #PBE
LONG BEN TRE#091
ego illusions#pbe
Chunji#chun
beishuiyizhan#121
Maris# PROE
i dont know#KRKR
Hsk#pbe2
4m6W4c5W7m2#PBE
hizutoblake#pbe
k0nda1#PBE2
Le chuyen2311#2320
Tungbb2k3#BB1
nny paradise#pbe
DVQ1#1997
Black Sheep #PBEEE
Lirujula
Ngoc6muitft#pbe
A Long#eptft
Liquidart#pbe
steelo of bora#ddd
fxs#bbt
Kawaii Tsukiko#OCE1
Superbio#9137
Piggy PBE#2007
shomapbe
wigwugg#pbe2
Natito#IVE
l Thanh Tùng l#PBE
kitool#PBE
sera 20 20#pbe
FF Skipaeus
41fer#fer
luckyboiz pbe#vnvn
CAP1#123
kr panda#pbe
dunizuni#pbe
KlicorneN#560
Upsetmax #123
Banh Xiu Pao#onehl
10thatworlds#pbe
Souless PBE#PBE
Skilluck#pbe
mèomướpđiăncướp#623
纪律歌#6523
Eren1710#1710
blingbIing#PBE
UNCLE419#6767
D U K I H A N#PBE
YyQ777#PBE
Mald PBE#PBE
ODESZA#S1C
Taylor1#PBE12
kr dry
Let it R0t #PBE
Harurutft#4771
Slayy in PBE#PBE
sssonagi#gyh
dankmemes02#PBE
oppiH#JWY
IMDONGCHAN #1234
sendtft#pbe2
PBE Maico#PBE
ARaye#pbeye
baboranung#pbe
iwish#123
hitt1#1607
Kahdeif#PBE
Ninie
Souly1#1234
pad0#PBE
k1an#PBEE
Abyss Z#PBE
Kirigiri PBE
Pengpeng3#pbe
micky1#1778
抖音丶Ace#123
luxfan#2948
Nuryy7#PBE
Fifi PBE #Mkhue
Ac1231#1231
PhosssPBE#PBE
mabbangking#PBE
GD Stillness#PBE
Enif#534
Canadian#beast
Pazitavish
yishujia#666
Succulento PBE#yuki
Sakurafan#IZONE
aixleft3#111
Gun2woo#pbe
DataTFT baifeng#you
xiaoyi PBE #7979
carelessd#777
斗鱼F4丶哑歌#yage
HenJi#9797
circle#8888
suirenka#bcrtt
sunjong kang#PBE
KR SAM D#PBE
rwe123
xexe diff#pbe
⁦KEO27 PBE⁩#⁦PBE⁩
whcssb#pbe
pickmeup#picku
Coriander298#coang
많고많은#마법사
djwcb
whyyoumadpro#pbe
arzoo #2211
Yeuhanhattt#pbe
wotinjianshanyin#PBE
top20thachdaus15#abcxz
Banhcute
testpbezz#1999
season6pbe#PBE
EA7 Shader102#EA7
iCeEmperod#mind
sohmm#PBE
StayAliveTFT#PBE
etre infame#PBE
rain99#4433
Brising#TFT
huanshuijian#PBE0
⁦danyangkkun⁩#⁦0705⁩
puppy2fast#hgat
BabaYetuu#PBE
MoGG666#MoGG
Bobiy#222
DizzyPBEz#zzz
venom#piano
riveting#PBE
lupius#1234
Sean Paul#12345
afreeca cosmo#PBE
OH MY DOG#PBE
Milo1#1234
RYT Luffyy#Missy
KR IFFY
mandii#asd
Marcel P
TRALAHARL#6761
deadlyco2#pbe
KR mby#1234
ToonTv#PBE
acma1#2703
LULULUCAS#PBE1
noomh#pbe
YYDM#yydm
DataTFTqujing
Bailong1#111
HannekoPBE#PBE
xuans#2992
baizhi#0906
NCC1#1997
m1zono#PBE
OolongTime#PBE
freyja#927
cavs801#PBE
a boy has noname #4385
lemonssss#7486
DataTFTxiakew#PBE01
KR donghany#PBE07
⁦FuryPBE⁩#⁦0208⁩
OP Chase PBE#0612
applel#PBE
LifeSquarePBE#2265
bes royan#pbe
BUGGY8282#8282
ZT Helx#0666
Castro#168
Tleydspbe#pbe
notrety
notving pbe
PunPBE#TFT
pbemilyy
Dhaien
Garkes#PBE
shushen2
TFToddy#pbe
Em Che PBE Set 16#3007
Solduri#PBE
wowlon342#pbe
phatngupbe#phat
nogamenolife#3279
Doublepaw16
robivankenob#PBE
MeoHor3#3920
reaper13461
baocoolzxcPBE#1204
혁듕#1004
we love mortdog#pbe
xuv#nvx
wxuzyyds#PBE
everytimeicu#19096
TEHGEO#5086
Elmumu#000
jjames#skrr
eustia#0002
SamFisher#RAY
DucDG#2305
Magarky#teub
IvdimDevetDevet#pbe
qute dog#1234
Bruhbruhbruh WHO#PBE
LanMei#123
saucepan1
149cm#148
uninogunkan#pbe
damlettuce#2323
TedZhu#PBE
dbao pbe#dbao
hokadeptrai#PBE
outboxerpbe#333
Iris Jr PBe#113
Kitvvlh#PBE
Yitzhak#NERV
onka#isa
LloyddPBE#PBE
Wingnism
1sqzz#0219
Monicaa#cute
cottontail#pbe
loescher#pbe
Anh dân 36#1205
NeganJr2302#smyy
best of kr#123
selimshady#pbe
Underdawg#PBEE
bllade#ppbe
FAKER of tft#백숭민.
santiimlg#pbe
Hyu PBE#218
Orsted SV VN#2910
Mimosa 7#PBE
br0ken69#pbe
patobsgPBE#pbe
Bwetro
Shaw1 Pbe #LOL
Stormy#8PBE
Yeon Hwa Lin#PBE
dih soap#veiny
Dep Trai It Noi#PBE
Bastida#321
dissaster#12138
waab
JianglinK#1226
DataTFTGreen#02020
veritas#1024
aurora#WGMW6
tarakoman#1111
Baileys#cute
Alexxdeptrai#1809
BasagiTFT#2003
cuberrubik#204
vakio f#PBE
DataTFTS1moky#123
Stily#PBE12
Levi PBE #CKTG
teachmeshreddin#pbe
gmlrnKR#0825
smogga#PBE
KsoK#KR12
chonxelich1234#hehe
gyuriim#2385
jongbum#pbe
backnumb#2934
eumpeng#PBE
"""

_TIER2_PLAYERS = """\
抖音绿皮鸭#20166
ttgk#PBE
544546#1111
yulibijii#1314
AG snowy#pbe
jhFpuxeJ#5515
TBD DaYa # 12345
ruiner#31825
Frank#2098
你算哪一块小饼干#10086
HWG#10000
DataTFTyishan#1313
Powfu NB#pbe
noita#pbe1
RNGUZI#123
Boing D Winnie #Pooh
AdaLee#PBE
Pancachee#PBE
Douyin丶Waston #7777
528hzCarti#PB
AzGriffon#222
jongyoon102
DCC#PBE2
8l minion#tft
Slooper#PBE
oCMCoqaq#qaq
GiayCoDong#1309
jihaning#pbe
jack#KC70
SatoruGojo#13619
Vinimex#pbe
Cool Guy Dom#beta
XENONXPBE1233#4733
dilmmctft
MANINGENZ#5963
Altenahue#PBE
Dante1mid#PBE
cccoki#pbe
Jigoa#PBE
youmeyou
Ashemoo PBE
Mobpsycho PBE1#6969
zuoduiguchu#TTovo
CrazyMoving#123
simplenmmpbe#pbe
raminec ita
TIKTOK BOGIATFT1 #hehe
testpbe123#222
sova3443#PBE
Atella#PBE
Doréto#pbe1
jeddiTFT
vanderkahn#pbe
ThemistoklePBE
mimicpbe#mimic
alo500ae#alo24
WO0RI#pbe
VN Thinh day
gyalubaby
Yvan#FFF
MEI ZI#PBE
EsPat#PBE
Miss The Rage#krpbe
KevinParkerTFT#PBE
hallo#1113
LittleBolt500#PBE
SW Hn#Hn
Lele#PBEX
riri pbe#PBE
StellarMinhee#pbe
neverwin#win1
Up Side Sunny#PBE
mùa sau vô địch
Krch1#2904
xiaoyou#bupt
Yuna PBE#7753
challgasip#3435
chencc#aug
CNTUTU#52000
pbefun#fun
MysteriousPBE#CaCon
Nahkiranowin#win
SoloDolo#Pbe01
Mizzzzzzz#1111
5454#pbe
grumble mable#2307
Nika7#tysnk
Team Fighting#xdxd
ehehehehehehee#pbe2
Choi Woong#123
VN Souma#189
XucXichPBE#pbe
Toroa The Awful#1234
elusivezed#pbe
dyfree#chess
DataTFT Lostmare#666
Quidoleymo
Notcho#PBE
PBE ABV1#11111
HighPikachu#PBE
douyinxiaofeng#24311
3SMALLPBE#PBE
Katsuta #PBE
RYT Tiaagowski#PBE2
bonnibel#PBE2
sun22y
mastamaopbe#PBE
opacan
Yuan#0206
ImpetuousPanda#CAST
kankanyouniu#PBE
manu#PBE01
kizichan#pbe
4pi#PBE
staigzortest#pbe
Listening to#PBE
pbe도르#kr01
beiucuaanh#PBE
Twift#PBE
Odinpbe#2000
B17rody#krpbe
kinuuuuuuuuuuuuu#PBE
Raneeylar#pbe
CrustyCracker#PIWO
FLASH1#66666
macpbe#1234
melody3#123
JoshyChanPBE #PBE
VN HA so sad #APAC
Yuri KR#TFT
Xuân Hinh#PBE
TipfyPBE#1234
wenye#817
lawl#bld
Ameng777#5408
kr luck bb#real
Yamato2826#PBE
Lumperich#PBE
Phoenixaapbe#pbe
milletopbe
satono diamein#tgl
SummerQwQ66#PBE
chandler#goku
Genos1pbe#PTA
陈海飞勒次够#998
KYKX PBE#PBE
bn ie#0127
odyceuz#tft1
CFC Ecstasy
Kezman#PBE
G1nkgo#1898
qweqweqwe#122
yanlimeiyouguang#pbe
yomsi2110#4172
soni#1340
云初1#mivvh
Rayeon#2705
tokyosniperPBE#URSAS
thinhh1#1208
Kez0s#PBE
Jesus Loves You#KOREA
tddPBE#0111
Panpann#PBE
DataTFT245674
KR dlwlrma 25
Failo Potato #PBE
Ingrid Lassing#PBE
techzz
Man I Love Fauna#bird
wondeRdotesPBE#TFT
TurtlezPBE#6868
kekemonster#123
Stryggar#PBE
Gidget PBE#1008
kokelol#pbe
sakuraho#123
AKI#00006
xesycy#PBE
egg#4889
Rafael Araújo #PBE
AMATOR1234#5524
Hardpuzzle#0212
SinisterGT#PBE
kbjjangjjang
LabsLabs #Labs
Lin1421#pbe
領域展開#WNYS
embebi#9999
Aroaro#0520
ChangshenLi #0922
PapyScotchPBE#12345
Knd Timmy pbe #4032
Wogga4#pbe
Midor1ya #pbe
QuazE PBE#123
EmThangTFT
miaomiaolikeTFT#PBE
engibunii2
Always Up#PBE
saebyeogN#soop
bepompomPBE
Dot#ImDot
TW clearlove784#PBE
darkest1903#pbe
작은거인1#SOOP
Cà Rốt Đi Ngủ#1707
Recls#PBE
Samuelqhyn
PBE FatLife#PBE
joseee #PBE
EivTOlRS#6922
jiyouu#pbe
kes0807
Narkez #pbe
pain1 PBE#5992
dysfunctional#8964
15ChorePBE
MaxccvPBE#KS14
PBEAriz#PBE
Dokhy#PBE
Business TFT#PBE
ygscatamite
Ole052#4268
Yangchi#817
beck3rpbe
koalittle#pbe
esadr#pbe
2Q2G6E5j4K7#PBE
Hak PBE#NANG
MobileLegen
TFTPANDAA#2025
nsnsns#kr123
SettiosPBE
chowderr#trist
peekaboo12#36205
yongchic
freezingfiref #PBE
vclf
inflames#PBE2
Wagner Gasosas#123
Spoti#PBE
jiboda91#666
oly#PBE11
enchaP#PBE
Nukomaru#PBE
Aroma#1405
mapong is karina#HAPPY
fakerzzgaming#3914
Arcane11#111
Quang #PBE2
KR RK#0908
Tona2000#TFT
Marks#PBE17
MDM Hielo
Huyee#PBE
shinsolitude0209#2502
Tempest II#PBE
zxczxczxc123#1512
Kenanz#3125
tduongw#2665
Learning TFT pbe
simjoo#PBE
defedici#balık
huyMH#7347
AKAWonder#PBE
left#peyz
KiBi#PBE
kuronagenaihupbe#IKA
rollsomemo#rsm
dpei#PBE
YakuzaTylerJuan#PBE
kr chall#kr12
Teukhan#PBE
BanVitCoRau0111#0111
ArashiNoNakaPBE#TFT
Lemon#1409
Garchompro Fan#PBE
minh123125
tattyPBE#2213
Jets#333
Gettey#0724
Dr4g111111#66666
tftgreatgameyes #tft
RYT Bãum#PBE12
Whentheycrytoday
PPAAN#KFC
recentShoes#69696
froggyandsherpa
Atad777PBE
Alea#3794
ShaneWhoPBE
ffstarx#8787
heyboyhello1111
toco gaita#gbr1
wojti#PBE
Karmaaaaaa#KDCR
rufflehuffle#2640
Cookiesop#pbe
twistlove3#0306
Heo Sao Mai PBE#0210
Garchompro#PBE
2018CNCN#7382
FreyrPBE#GOGO
SXY BanaRoll#ROL
Wulegend#pbe
IridescentFlower #okk
trevisan#tftbr
siq santinho #chibi
shiqiye#3077
pmkstinkyabuser#PBE
isjerboa#PBE
Chovy12#1234
darkfrincess #kr3
ATRI041013#CHINA
BlueDawnPBE#0410
AitneipasPBE#CL23
hyun min#wise
ViolaDWY#0828
VN h1ha#mhieu
EmterorPBE#2129
halloweens#loona
PainGetsReal #PBE
Qianyuan#wow
Coco PBE #152
soltea#PBE2
morphan PBE#911
Ians Mom#PBE
mario196 #196
DanielsPBE#Dan
ich bin bin#kr2
Bialy Lis#PBE2
jcuuub#fat
Gambler#EU6
reisu777
luffy57773pbe#pbe
dlgusqhr1234
Jokić#2327
Vancell#PBE
DataTFT nanxiao#666
bigzoufan4#MSJHS
CERDO#PIG
medicsock pbe#888
Chenyh#5044
Lelouuch#12345
WyrenPBE#pbe
再见过犹不及#000
ManuNow
MGHotDogPBE#5656
AgusWang#PBE
Decisiveway#PBE
alwaysneverflush#6969
Yugi PBE#0707
fishpbee#PBE
ZBHRuaRua#CHE
SIXHEADIQ
zzzzomb1e#PBE
dsadanhh#PBE
qingnian#66666
BlucksPBE#TFT
 VN #PBE
JerunduxaDD#9740
xiaobaizii#PBE
Alrath#PBE
BALOTELLI777 PBE#pbe
T1 2viett#8386
Xpirit#PBE
SacaluluPBE#Sacal
CelalaltBocozina#PBE
tequilasunrisee#toro
yyyueliang#PBE
GauGami#PBEE
Hương#14082
Schnuu#PBE
PBElwx#2577
antigenius#66666
MDM BiterLife#MDM1
linhdz#pbe
Sỹ Hùng#1235
tftdark#tft1
BladeKing#9382
doy#asahi
BESTIAROCK22#PBE
SilksongDLC#1832
thachdaunhung#tft
DYAMZ L3333333T #dmz00
Viego#0711
MartSeeOne#2304
GIGIMURIN FANACC#GREM
chessiscold#cic
Nnn11#7979
GoukiYeungPBE
hackkaka#1122
Chengo#PBE
tpgns#6529
leeminhduc2#1984
Mortpuppy#pbe
JuanGhurkas#3614
balou#jgdif
TESTNAO #PBE
Winkey1#1712
DayumSayum#PBE
hellotherebro#PBE
taplast#pbe
Portuguese Babe#Babe
zheyunchixia#77077
priNcesvalPBE#PBE
shimapen#PBE
b002258888
young1wave#KR1
bullarai222#222
dwpbe#0904
tarmyshanepbe
all out
PBEGODMAN#666
Zbrojson#pbe
EdmanNx#1111
nanzal pbe #111
Erith PBE#PBE
y1j1n#yijin
Coils#pbe
Daidudu#206
blah blah blah#lol
Leatherboots97#2608
shain#AAA
DaVinci01#5458
Joerg#PBE
proto#3110
N8hanPBE#PBE
OK1D0K1 #0122
NABAWIPBE#PBE
BIRUPBE#PBE
301ye#2434
Matisso#PBE
curry#kr11
EmDunglamduoc #7306
ACE Lusth#PBE
stopteqhPBE#PBE
Metzauh#PBE
Mikkoslave
Subtlecloud#PBE
Dlwlrma1 PBE
Rules#PBEE
"""

_OPEN_PLAYERS = """\
Twitch Jordan4am
Tactics #MPC
DY03#PBE
StrongEstetTV#PBE
Tobsss#PBE
FungsterPBE#1216
⁦BananamiPBE⁩#⁦8236⁩
phuc2005pbe#2005
offensively#kr12
Datdeptraivl#PBE
gnralphie#yeah
migggg#666
n9 on pbe#pbe
WeatheReportTW
ModvaniPBE#PBE
Tu Tiên Giả#YÊU e
DuyLoveHoa#21911
SHoo55#PBE
harmoney#pbe
FFff#PBE12
藏于坠明#1423
⁦sozgod⁩#⁦PBE⁩
pbe monster 99#bbtea
bbonyo#pbe
PBE Gardorr
Em Naa#2004
⁦ẨN PBE⁩#1411
KaoruP#PBE
크래프트#1111
Eldhelm #123
L9 dishwasher#PBE
DeLaFill3#7259
jinx#444
beedog#0927
konst1pe#PBE2
chocotomatoPBE#239
SmilingBoi#PBE
KIENPBE25#PBE
Huydeptraiqua1#1001
PBE Dawnte#PBE
Meiko Chococo
loluser#1234
Diogo Tft#TFT
L0ckusPBE
kryyy
PBE mee#PBE
nomi74#PBE
Petikk#pbe
msh#PBE2
SHiRoxK0909#0909
Armasmalas#pbe12
TFT ekko#PBE
SXY Théoden#SXY
itzGator#PBE
Teterre#PBE
Mujjiwaraaa#PBE
XDDDDDDDDDXDDX#XDDDD
m1zuh4#2911
BurtleyTFT#PBE
Lukwer TFT#Kata
Nevada34#PBE
Jaway#WU1
VN ThanhHoang#PBE
JanDuszesPBE #PBE
DannyQQPBE#PBE
keldratactics#69420
timmy081tw#PBE
Swipers3#321
The Perfake One#pbe
symtftpbe
Aiguillette#4083
BATPYJ#PBE
NoEvidence2#Ev404
PBE Hyakuya #PBE
ren#xing
HampikPbe#PBE
milsug cu pofta#PBE
CurryPBE#0007
NibblesPBE#INTA
chizzl#PBE2
Lose 4 Nudes#PBE
Sanh Phùng PBE
ZeskoPBE#EMEA
MasyTFT#3585
XAN Autaka#TFT
xDerekPBE
Geopunch#mie
PlinnWesley#EBP
Priseasana#11550
BYZM#1011
Zain1224#PBE
UMRgurashiPBE
Matiaxxzz#2425
krjinsusong98
judas1pbe#na2
Leafypbe1#2309
xobhh#024
DrEddyPBE
Twitchyoz#8787
kha nhu cute#PBE
asphy#0396
Phantom#pbe00
TWTV Baltazar001#PBE
Larryyy#pbe
HermitMxPBE#PBE
thanhcuibappp#1611
Bassie#PBE
DRIO#123
raikugen#tft
Bin Reum #PBEEE
YunoBWF#1110
Barbacoa#2002
jekdongKR#0908
etre superieur#PBE0
KheePBE #Khee
BotsmanPBE#000
quangfptpbe#2306
mp1#0711
winkwinkmerong#4214
timavilla#msk
laventus1 #PBE
TrulyHumbleXD#SLIME
guustih#pbe20
hilare#PBE
xingyunxiaoyang#7777
vippimies13#pbe
internettrold#PBE
gamjaKR#gombo
snoozy#pbe0
dmsssssss#PBE
santiiii27 #PBE
OGolfinhoPBE
HongTranTien #PBE
SkimarPBE#pbes
ImpagnaTPBE#tft
Pandaa972
Jesusito19#SJ25
Astrid#Dotee
KhiemIdk#2612
Kanna Enthusiast#PBE
Umiyokod
xiaoduo#QAQ
Roshaque#777
Calster#PBE
Dori2#5582
Airimania#riaf
hecktik
aaaaniya#PBE
vaxonpbe#top1
Sakura#34852
CreamingOnPBE#123
Dairl#123
Stoic PBE#hihi
sherlockpbe1#pbee
FF p4c3s#Flip
Splyyyn
partaegeon
SevenEnd7#PBE
xiaoxi#129
TalelGPT#PBEE
ccasely#PBE
比菲多喝水#1111
Fizz#PBE7
iceneedle#pbe
KingOfThePirates#PBEE
TuanKoPro#PBE
NTPQ#9766
AnkallE#PBEE
LevitatePBE#tate
Em Khiêm Coder#1308
LousOfficial#0309
QrczakiniPBE#000
ZT ChangoBichi #6640
twitch terrytft#PBE
pdnpbe#pdn
pbe milo#pbe
hoanglong1#testT
rysordpbe#pbe
PerryGRR#PE1
chanhiuu#1709
thang6223
Lmilio pbe #wpp
Testaffe#PBE
July PBE#6796
NinePhiro#TFT
SweatLabor
mingafloja#2678
Đăng Hoàng#iuem
Iamsogooddw qd#kkkk
GnarlyBurno#89732
kotosin04pbe
无
menheraboy#kor
think2wice#4367
absoloot#clean
kaiPBE#PBEEE
gold bog#21532
Binoculous#PBE
clockboy#9859
Wassly#3326
AmebenzPBE
姜海喵喵粼#0722
Skot1k#TFT
FBG Beckem#PBE
godpbe9091
eldistanzxd#xdd
zuishuaicuncao#pbe
ZT koi#torii
excellent name#PBE
lawww#pbe
JesusTeemo#PBE
MaoPudding
TFTkomugi#777
Yeet#6074
FranceB#PBE2
Skarmy#TFT
TiltVayneGG#420
thunderking83#PBE
Khalifaboy#PBE
ShinyaRemin#PBE
sIQ Chibi#sana
oxxo#pbe
Stargazer PBE#1102
GJAH#8686
Ts19zzzzz#Ts19
ThystPBE#PBE
TarzanMST#PBE
Maple#Arro
reeeeeeroll
RYT dois#7425
polo mp#PBEE
CochsakenPBE#PBEEE
9872341105424982#PBE
Domper#PBE
V3rm0uth#10086
ballom#PBE
easonbqc
thuphuongK37#PBE
5M1m3o9s8b#PBE
drsteelhammereuw#pbe
bongdal2#pbe
Woodentable#1234
Fobia #kekw
SXY BossManele#SXY
AnVinh17#PBE
MantasDabsPBE1#PBE
Ydarp#PBE
CST Plester #CST
gipeun#111
PucmanPBE#GenG
100种生活#3839
Fundamentals#PBE
JosneyQT#PBE
Jordi WIld #Metal
DR ROH#0523
Concertoinpbe
feesOWO#7777
Kbaobao#PBE
blackbigbig#1017
Derrotra #pbe
TFT Maybe
bambasaur992
Flaschenkönig#PBE
MDM KingaSensei#MDM1
Vulp1sss#1111
TurboARAM#PBE
bongsam
Spike Spiegel
KangsterTFT#Kang
b1dasu#PBE
PRO5EKKOPBE#L2P
FelixMatos#PBE12
gochujang#pbe
hive king#tvtw
PBEeeroy#jkins
Popow#1912
ChopZen#Mind
DaynEPBE#NNA
skyzzocs tft#PBE
BruceUdacznik#ren
shroomzz#TFT
Duckkk#Tom
saiyaman11
treloPBE
aokijiPBE#PBE
KoiKhatSai#84864
ZoomSlay#PBE
tedd1ursa
noju#pbe
VanherPBE#PBE
k1rqi#pbe
fsn#pbe
Thalesbluu#1108
Ramyeo#BomBA
JABATO PBE#JABAT
ヤミラミ#NEMUI
onenightstudy#sech
Smietana#KRWL
pbecaf#123
Subzeroark#PBE
V0 CYBURNN #PBEEE
tiendz3#bingu
IgginsLaSaucisse#PBE
LittleAngeI84#TFT
Rabi#PBE
Bokchi#777
WlostekPBE#123
ZT Coqui#7325
Hitomipbe1#oce1
MonoDipp1P#1511
spacewater#123
skeletor pimp#pbe
MB ChocoBN #GATO
YE4H #TFT
CrushingMemes2#PBE
WilliamSeedXXX#PBE
ewik#ttv
NaiePBE#9999
Dorindan
habui#lbien
reitnorf PBE#0000
datingwithMing#Meow
Saul PBE#TR182
MasterYi941219#1219
ChessGuy1
owww#pbe
Chú Bảy#BibiE
Bao1#Bao1z
LilP90Vert#6954
Om Hum
rinakatarinaa#RINAA
Lab 061 tlyee#PBE
JannitoPBE#PBE
RazziuPBE#LION
Minnnnnn#PBE
lunaspeace#2487
pbePray God #pray
JustDonutz#727
Kororong#1557
FanWonYoung #ive
TheAstro
floWPBE#6848
JustRemikun#PBE
Greataxe#328
hnuisqt#htuah
PBE Jeuynh#PBE
emquanpbe#17402
Diegots#1234
emilWRLD#ursas
FlashGamezzzPBE#6767
Hamigua
tenmusudayo#PBE
Dr Rodri#123
BillyCanCarry#PBE
Deppche #PBE
TTV LuminousTFT #TFT
HansZimmer#PBE13
8LJAYWALLKING#KRI
sabrina fan#DSJ
AunPBE
Thorvahkin123
SemiA#kr2
InkOssia#91411
imMkoyyyPBE1 #2412
IamActuallyLvL1#PBE
Rhya#Pkmn
KC NEXT PBE KING#K C
Panekoo#NYA
NumeritosPBE#PBE
5vanofTFT#kekw
Soulninja4#9603
SeeUDownTheRoad#2222
teefswalrus#2809
grzegorzqw2#pbe
CukratkoLP #PBE
MarlonXPBE
XingXing#8028
ADWANGPBE#9265
Gragaspbe#19999
Sobad8PBE#100
SouhiKen#YES
DR4G0#GGS
綠茶這季別一輪好嗎
iplaytft103#PBE
KR MID 1
bustyball9119#bbc
TwitchCallmeJay#111
abawawa#PBE12
Tempery
Xyronicpbe
depenn#1111
Dyah3#1234
bibikalol#PBE
Fabulotus#PBE
FikesTwo#PBE
CobaTFT#2105
Sl4sh3r#PBE
100giantworms
smfc#PBE
Halatcoris#71871
Ekoo#PBE
ConTraiCuaGalio
xfOpxlvY#1523
Xhesto#PBE
HCP#no2
SkibidiRizzler#69420
lllldldlllldl#sddf
tob4rg1#tobz
K1Low#PBE
toilaminh#2603
TJkingwo#PBE
xshanex25
Fanboiz Jisoo #PBE
yiyaunqi#8767
OrlazzzPBE#ZZZ
HydroQT#PBE
oqqy#132
slakemoth
BIGZOUHATER#94539
StephAeri#aespa
Pablito #X020
Jiten#PBE
PeacefullyPBE#4904
Ducnew234#1234
Kong Trần #Win
Edjoe#PBE
WildPBE#3697
HackCute2PBE#0103
CueRvooo #lolo
wadodayo#ouo
ElvenNoBaka
PiKachu0706#1230
shuaigedan#pbe
esok#PBE
hiepdzpbe#11111
chanzigaoshou#pbe
ryoumajima#5186
Toof#PBE
Byungkuk#PBE
BobbB0x#11123
m1ckkk#306
catboy#pbe
IceCreamHobo#PBE
itssgabriel18#uwu
oRisingTide#PBE
SinchansonPBE#9725
Nie
bbbbbbbbbbbbbbb#PBE
LayzixCHALL
Sebv#pbe
phanthiquynhmai #ukj
LuvLetter #onPBE
PuiPuiMolcar#4911
SmothOperatorTFT#PBE
MelonPBE#4545
shkd#1508
Dimo#DDD
Jirenn#PBE
ANDYBUTTSTUFF993#tty
haykaroo#1111
Rerollg0d99pbe#7369
kyyyyrrrr#333
Soko PBE
Gardie Dèfi#PBE
GuttaManero
PBE Eric Cartman#PBE
MJS Adrinedi #TFTpb
truongprosl#12131
terracubistpbe
PBE Ferday#GITA
relicpbe
PBEsu#1234
cheriosjon
lytingQwQ#2001
FrostTera#2002
Celery#kpop
drmr
Zuko1337PBE#PBE
KARINAAB #PBE
Mehujaa#PBE
fat pear#succ
jooyoung123#PBE
CakeTime#5148
thainguyen97nt
askeladpbe#pbe
TFT Dolly#TFT
nanapypbe#1223
Áirfork1PBE1299#1463
Path of Gaming X#PBE
Alsomepbe#5616
Nammm#6105
Mainjobeta#PBE
DekZo#lily
MGC stcky#pbe00
YasinAkinci#PBE
I am a Bot#2836
Contrast
weewoobiu#2486
pjmangopie#3534
777#7pbe7
TSTShin#0207
Drvu#777
EvanTheGWeeb#9980
Akira#dairy
XeroD1e#12345
Essentiam
DuckyTFT#1234
Kitora#PBE
TR kcv#PBE
imactuallyadam
loximPBE#PBE
Ventair#4515
mellomood#pbe
B612#zzz
Chuongpro#7777
nofunallowdpbe#2313
Tiger000000000#PBE
대깨황금황소
LUNA Erza#PBE01
Trung Vladimir#PBE
mendakoPBE#0101
Kaehu1#PBE
Ucantmilkthose#PBE
ckdoesitoften#0302
mayuri24pbe
jofish#pbe
coelho#coel2
ArEoSs11 PBE#GOAT
Lonevale#TFT
PBECL0702
frankspank#1444
Gatita TFTera#holii
polarnikkker#1234
bbyangl#jrjr
HanHanHanC#1112
SamiSamuel#PBE
CoffeeJellyPBE#PBE
c6 ganyu#pbe
Bananabill#PBE
RoXaS#0801
busydevpbe#17072
Zouilllllesque#4340
Jumeirah#PBE
MrTy1#zzz
fundamentals1#111
zev#iwnle
elChrestoPBE#187
Mactilterson#4681
mbpungapbe#4179
CaotenazTFT#666
LE SSERAPHINE#3129
JFWEOIRMJIRWJIUW#FNIOD
DompsPBE
Achnologue#PBE
Spli#123
sodio#pbe
Darken Shallow
kd230pbe #test1
Simplycanthit#pbe
Dontkpbe#Dontk
Gremmy25
Gardolini PBE#PBE
MoreAmy#TFT
guba#pbe
PBE Chazen
Andy#1or8
nhathoang1#PBEEE
rellmain2
DiscsOnly
Magstar20#PBE
Micho And Tito #PBE
hisagitft#tft
Greiend
MateoXPompa11#9153
Janav#PBE
niiklauus
Phú Văn1#12584
ganahal#wan
10cc#313
jowoahpbe#tft
An Bo Di#12129
Casperpool#pbb
Spi
wander1ust#pbe
GuessWho#Griv
27 05 99#Rua
donggeun0131pbe
Envyaah#PBE
stangpbe#TMNB
yolotest #PBE
SamSandSalmon#Sand
Khao#VNN
kingoffruits#fruit
jaewook#1111
shuabootft
whatisryanPBE
Templeton #PBE
HealthPrince
H20 Henry #PBE12
WTBA VanoZz#5276
chiii#1515
Bobby Bobberson#4699
GeeBeeMonPBE #PBE
Gangly#pbe
"""

def _build_tier_map() -> dict[tuple[str, str], str]:
    """Build a mapping of (game_name_lower, tag_line_lower) → tier."""
    tier_map: dict[tuple[str, str], str] = {}
    for tier, raw in [("tier1", _TIER1_PLAYERS), ("tier2", _TIER2_PLAYERS), ("open", _OPEN_PLAYERS)]:
        for gn, tl in parse_player_lines(raw, default_tag="pbe"):
            tier_map[(gn.lower(), tl.lower())] = tier
    return tier_map


_TIER_RAW = {
    "tier1": _TIER1_PLAYERS,
    "tier2": _TIER2_PLAYERS,
    "open": _OPEN_PLAYERS,
}


def build_player_list(tier: str | None = None) -> list[tuple[str, str]]:
    """Parse tier lists, deduplicate (case-insensitive). Optionally filter by tier."""
    if tier:
        raw = _TIER_RAW.get(tier, "")
        return parse_player_lines(raw, default_tag="pbe")
    all_raw = "\n".join(_TIER_RAW.values())
    return parse_player_lines(all_raw, default_tag="pbe")


# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Resolve Riot IDs → PUUIDs and store them in the Player table (run once)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tier",
            choices=["tier1", "tier2", "open"],
            default=None,
            help="Only process players from a specific tier (tier1, tier2, or open).",
        )

    def handle(self, *args, **options):
        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(self.style.ERROR("RIOT_API_KEY is not set."))
            return

        tier_filter = options["tier"]
        player_list = build_player_list(tier=tier_filter)
        if tier_filter:
            self.stdout.write(f"Filtering by tier: {tier_filter}")
        tier_map = _build_tier_map()
        self.stdout.write(f"Player list: {len(player_list)} unique entries.")
        self.stdout.write(
            f"  Tier breakdown: {sum(1 for v in tier_map.values() if v == 'tier1')} tier1, "
            f"{sum(1 for v in tier_map.values() if v == 'tier2')} tier2, "
            f"{sum(1 for v in tier_map.values() if v == 'open')} open"
        )

        existing: set[tuple[str, str]] = {
            (p.game_name.lower(), p.tag_line.lower())
            for p in Player.objects.filter(puuid__isnull=False).exclude(puuid="")
        }
        need_fetch = [(gn, tl) for gn, tl in player_list if (gn.lower(), tl.lower()) not in existing]

        # Always update tiers for existing players
        tier_updated = 0
        for p in Player.objects.filter(region="PBE"):
            key = (p.game_name.lower(), p.tag_line.lower())
            new_tier = tier_map.get(key)
            if p.tier != new_tier:
                p.tier = new_tier
                p.save(update_fields=["tier"])
                tier_updated += 1
        if tier_updated:
            self.stdout.write(f"  Updated tier for {tier_updated} existing players.")

        if not need_fetch:
            self.stdout.write(self.style.SUCCESS("All PUUIDs already resolved — nothing to do."))
            return

        self.stdout.write(
            f"  {len(existing)} already in DB, fetching {len(need_fetch)} from API…"
        )

        accounts = asyncio.run(fetch_accounts_async(api_key, need_fetch, stdout=self.stdout))

        saved = skipped = 0
        for (game_name, tag_line), data in zip(need_fetch, accounts):
            if data is None:
                logger.warning("Could not resolve '%s#%s' — skipping.", game_name, tag_line)
                skipped += 1
                continue
            puuid: str = data.get("puuid", "")
            if not puuid:
                skipped += 1
                continue
            tier = tier_map.get((game_name.lower(), tag_line.lower()))
            # Handle renamed players: if puuid already exists under a different name,
            # update that record instead of creating a duplicate.
            existing_player = Player.objects.filter(puuid=puuid).first()
            if existing_player:
                existing_player.game_name = game_name
                existing_player.tag_line = tag_line
                if tier is not None:
                    existing_player.tier = tier
                existing_player.save(update_fields=["game_name", "tag_line", "tier"])
            else:
                Player.objects.update_or_create(
                    game_name=game_name,
                    tag_line=tag_line,
                    defaults={"puuid": puuid, "tier": tier},
                )
            saved += 1

        self.stdout.write(
            self.style.SUCCESS(f"Done — {saved} saved, {skipped} could not be resolved.")
        )
