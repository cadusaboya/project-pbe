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

import httpx
from django.core.management.base import BaseCommand

from tracker.models import Player
from tracker.services.riot_api import RiotAPIService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hardcoded player list
# Lines without '#' default to tag_line='pbe'.
# Unicode directional-formatting chars (U+2066 / U+2069) are stripped.
# ---------------------------------------------------------------------------

_RAW_PLAYER_LIST = """\
VA PA CASA#1278
ego illusions#pbe
hsk#pbe2
PedroBatata#PBE2
JuanGhurkas#3614
HoroX#226
dehuapbe#pbe
pbepanny#pbe
Bapzera#PBE
Oquintaniilha#2729
notrety#PBE
huachenyu#PBE
Lab 003 Broseph
barley tea#bmk
me1stor8th#PBE2
dankmemes02#PBE
qiqiehtnaf #pbe
KRMXPBE
junglebook1#jb1
Bruhbruhbruh WHO#PBE
PRESTIVENT#pbe
Nipple Overdrive#PBE
J or C#PBE
Upsetmax#123
LeIronJames#pbe
FungsterPBE#1216
LadderSlayer PBE#PBE
DarthNub#PBE11
riveting#pbe
MillenniumFoxPBE#TFT1
Souless PBE#PBE
robinsongz #pbe
Dishsoap pbe
JosueDeleted#PBE
wigwugg#pbe2
wasianiversonPBE#pbe
DQA
Sucksuko#pbe
Ted Zhu#pbe
phoenixaapbe#pbe
deadlyco2#pbe
Spencertft#pbe
SantiiMLG#PBE
Black Sheep #PBEEE
IronBogPBE#999
the tristan#PBE
jazlatte#pbe
Yeso#tw666
WithoutYou#4313
titletitletitle#pbe
undake#pbe
yatsuhashiPBE#pbe
kaito716#PBE
unigun#pbe
mori pbe1#PBE
inpath#1234
Maladjust#12345
steelo of bora#ddd
BUGGY8282#8282 
KRsCsC#PBE
DR OH#PBE
Souly1#1234
seoill#2102
KR Pengdori#PBE
Binteum#PBE
CAP1#123
Kahdeif#PBE
lupius#1234
PBECinas#4683
DayumSayum#PBE
ARaye#pbeye
eggay1234#PBE
Mald PBE#PBE
SheeepStickk#PBE
Enif#534
steppy #2119
Stryggar#PBE
NanandePBE#nna
Kbaobao#PBE
YYDM#yydm
shushen#PBE
Kitool#PBE
Lilbear#bear
Banh Xiu Pao#onehl
yby1#pbe
TIKTOK BOGIATFT1 #hehe
hizutoblake#pbe
Milo1#1234
Le Chuyen 2311#2320
KND k1an PBE#PBE
Maris#PROE
MidFeed so bad #PBE
GobosteurNA#2325
Loescher#pbe
EliaPBE#269
blah blah blah#lol
Lyyyress#PBE
10thAtWorlds#pbe
Dicob#1401
TEHGEO#5086
Alegory#GLORP
FF Skipaeus#200
Keayser le goat#pbe
vomendeth1#PBE
K6 Marks#PBE
ZyK0o#PBE
xus0o PBE#PBE
bensac#pbe
Voltariux#PBE
Hypno#pbe2
M8 Enzosx #pbe
Canbizz61#pbe
Jonction#PBE
Narkez #PBE
Kc double61#PBE
Toontv#PBE
M8 L3SCoco #PBE
ODESZA#S1C
Kojnid#pbe
luffy57773pbe#pbe
Reventxz pbe#pbe
Yobidashi#1507
Cynaar #PBE
Safo20#PBE
keayser le goat#PBE
KevinParkerTFT
kubixon#PBE
Garkes#PBE
ARZOO #2211
ViggoZe#PBE
Opale#2102
Dalesom#PBE
Clemou#WTBB
whyyoumadpro#pbe
pepoglad#PBE
PhosssPBE#PBE
Guillosko#PBE
M00ritz #PBE
Tomino66#PBE
mr tarte #pbe
Opale#2102
tomjdsssss#pbe
m0tiv#pbe
Rcs xperion#osp
Deis1k#pbe
traviscwat#PBE
Rykomastery pbe
TFT AUG #PBE
NoelPBE#PBE
Asta1 PBE#testd
Gingpbe #pbe
CrazyCatPBE#PBE
DavidAs202#TFTQC 
Marcel p#pbe
TarteMan#PBE
halloweens1#loona
flamez#9842
idk but hes good trust
Garchompro Fan#PBE
ebicc gamer#4674
ProtectScrollPBE#PBE
robivankenob#PBE
tleydspbe#pbe
Solduri#PBE
dih soap#dih
panche3e#pbe
filuppbe#pbe
TFToddy#pbe
Koalittle#PBE
trevisan#tftbr
lawl#bld
twitch taro jp
vanderkahn#PBE
FAKER of TFT#백숭민
YouTellMe#PBE
i dont know#KRKR
KR donghany#PBE07
kr panda#pbe
Mandii#asd
WO0RI#PBE
sunjongkang#PBE
dunizuni#pbe
Kirigiri PBE
joseee #PBE
alwaysneverflush#PBE
149cm#148
stayalivetft#PBE
pk1#PBE
Succulento PBE#yuki
SatoruGojo#13619
ArmaTruc#pbe
Frodan#DADAN
y y y y#1312
br0ken69#PBE
Kezman#pbe
TurtlezPBE#6868
Bastida#321
Petikk#PBE
Snoodyboo#5033
Crescent#xpbe
buralsu
micky1#1778
ran111#1234
Flancy#PBE2
LIGhtYgo#PBE
liluomax#6017
TBD DaYa#12345
cycyds#pbe
bby#pbe
lbtz#p be
Ringo#5612
koyui#TFT
抖音绿皮鸭#20166
Serein#318
dy chuyin#46666
houzishangshan#pbe
jason#20040
抖音丶Ace#123
sakurazhenbai
go fly#pbe
sayaovo#233
tukuai1 #12138
Far3well#pbe
ChangshenLi#0922
huyashendu#pbe
vGcghZll#5078
Qiyue#0113
chuqi777#PBE
蝴蝶s#1314
wmlq#4838
NoobCai#pbe
Lavette#pbe
douyinxiaofeng#24311
HenJi#9797
Oyster#77777
老墨o#45534
godbee#1435
JianglinK#1226
#cxl1717
SummerQwQ66#PBE
miaomiaolikeTFT#PBE
夜灵王#123456
DataTFT Lostmare#666
YG otto#pbe
72h7b3v42@femail.vip
Pasta#0212
wxuzyyds#PBE
Lirujela#27570
ToumaKazusa77#pbe
云初1#mivvh
Lin1421#pbe
TFTPANDAA#2025
"""

_STRIP_CHARS = "\u2066\u2069\u200b\u200c\u200d\ufeff"


def _parse_player(raw: str) -> tuple[str, str]:
    cleaned = raw.strip()
    for ch in _STRIP_CHARS:
        cleaned = cleaned.replace(ch, "")
    cleaned = cleaned.strip()
    if "#" in cleaned:
        game_name, tag_line = cleaned.split("#", 1)
        return game_name.strip(), tag_line.strip()
    return cleaned, "pbe"


def build_player_list() -> list[tuple[str, str]]:
    """Parse raw list, strip blank lines, and deduplicate (case-insensitive)."""
    seen: set[tuple[str, str]] = set()
    result: list[tuple[str, str]] = []
    for line in _RAW_PLAYER_LIST.splitlines():
        line = line.strip()
        if not line:
            continue
        game_name, tag_line = _parse_player(line)
        if not game_name:
            continue
        key = (game_name.lower(), tag_line.lower())
        if key in seen:
            continue
        seen.add(key)
        result.append((game_name, tag_line))
    return result


# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Resolve Riot IDs → PUUIDs and store them in the Player table (run once)."

    def handle(self, *args, **options):
        api_key = os.environ.get("RIOT_API_KEY", "").strip()
        if not api_key:
            self.stderr.write(self.style.ERROR("RIOT_API_KEY is not set."))
            return

        player_list = build_player_list()
        self.stdout.write(f"Player list: {len(player_list)} unique entries.")

        existing: set[tuple[str, str]] = {
            (p.game_name.lower(), p.tag_line.lower())
            for p in Player.objects.filter(puuid__isnull=False).exclude(puuid="")
        }
        need_fetch = [(gn, tl) for gn, tl in player_list if (gn.lower(), tl.lower()) not in existing]

        if not need_fetch:
            self.stdout.write(self.style.SUCCESS("All PUUIDs already resolved — nothing to do."))
            return

        self.stdout.write(
            f"  {len(existing)} already in DB, fetching {len(need_fetch)} from API…"
        )

        accounts = asyncio.run(self._fetch_accounts_async(api_key, need_fetch))

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
            Player.objects.update_or_create(
                game_name=game_name,
                tag_line=tag_line,
                defaults={"puuid": puuid},
            )
            saved += 1

        self.stdout.write(
            self.style.SUCCESS(f"Done — {saved} saved, {skipped} could not be resolved.")
        )

    async def _fetch_accounts_async(
        self,
        api_key: str,
        need_fetch: list[tuple[str, str]],
    ) -> list:
        service = RiotAPIService(api_key)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as client:
            tasks = [service.get_account(client, gn, tl) for gn, tl in need_fetch]
            return await asyncio.gather(*tasks)
