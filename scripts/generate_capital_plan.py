#!/usr/bin/env python3
"""V-Swing Capital Deployment & Rotation Framework - PDF Generator"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'skills/pdf/scripts'))
from pdf import install_font_fallback

# ━━ Cascade Palette ━━
from reportlab.lib import colors
PAGE_BG       = colors.HexColor('#f2f2f1')
SECTION_BG    = colors.HexColor('#f1f1ef')
CARD_BG       = colors.HexColor('#f1f0ed')
TABLE_STRIPE  = colors.HexColor('#edece9')
HEADER_FILL   = colors.HexColor('#4f4a38')
COVER_BLOCK   = colors.HexColor('#726c58')
BORDER        = colors.HexColor('#d4d0c4')
ICON          = colors.HexColor('#7d6d3e')
ACCENT        = colors.HexColor('#a18632')
ACCENT_2      = colors.HexColor('#5d39c9')
TEXT_PRIMARY   = colors.HexColor('#272623')
TEXT_MUTED     = colors.HexColor('#77756e')
SEM_SUCCESS   = colors.HexColor('#448b5c')
SEM_WARNING   = colors.HexColor('#947d4d')
SEM_ERROR     = colors.HexColor('#934841')
SEM_INFO      = colors.HexColor('#5a7da1')

# ━━ Font Registration ━━
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
import platform
_IS_MAC = platform.system() == 'Darwin'
FONT_DIR = os.path.expanduser('~/.openclaw/workspace/fonts') if _IS_MAC else '/usr/share/fonts'

pdfmetrics.registerFont(TTFont('FreeSerif', f'{FONT_DIR}/truetype/freefont/FreeSerif.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Bold', f'{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Italic', f'{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-BoldItalic', f'{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf'))
registerFontFamily('FreeSerif', normal='FreeSerif', bold='FreeSerif-Bold', italic='FreeSerif-Italic', boldItalic='FreeSerif-BoldItalic')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans')

install_font_fallback()

# ━━ Styles ━━
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.units import mm, cm, inch

sH1 = ParagraphStyle('H1', fontName='FreeSerif-Bold', fontSize=18, leading=24, textColor=TEXT_PRIMARY, spaceBefore=18, spaceAfter=10)
sH2 = ParagraphStyle('H2', fontName='FreeSerif-Bold', fontSize=13, leading=18, textColor=HEADER_FILL, spaceBefore=14, spaceAfter=6)
sBody = ParagraphStyle('Body', fontName='FreeSerif', fontSize=10.5, leading=17, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=8)
sBodyLeft = ParagraphStyle('BodyLeft', fontName='FreeSerif', fontSize=10.5, leading=17, textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceAfter=8)
sBullet = ParagraphStyle('Bullet', fontName='FreeSerif', fontSize=10.5, leading=17, textColor=TEXT_PRIMARY, leftIndent=18, bulletIndent=6, spaceAfter=4, alignment=TA_LEFT)
sSmall = ParagraphStyle('Small', fontName='FreeSerif-Italic', fontSize=9, leading=13, textColor=TEXT_MUTED, spaceAfter=6)
sCallout = ParagraphStyle('Callout', fontName='FreeSerif', fontSize=11, leading=17, textColor=HEADER_FILL, alignment=TA_CENTER, spaceBefore=6, spaceAfter=6)
sTableHead = ParagraphStyle('TH', fontName='FreeSerif-Bold', fontSize=9.5, leading=13, textColor=colors.white, alignment=TA_CENTER)
sTableCell = ParagraphStyle('TC', fontName='FreeSerif', fontSize=9.5, leading=13, textColor=TEXT_PRIMARY, alignment=TA_CENTER)
sTableCellLeft = ParagraphStyle('TCL', fontName='FreeSerif', fontSize=9.5, leading=13, textColor=TEXT_PRIMARY, alignment=TA_LEFT)

# ━━ Helpers ━━
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                 PageBreak, KeepTogether, HRFlowable)
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.platypus.flowables import Flowable

class CalloutBox(Flowable):
    def __init__(self, text, bg=CARD_BG, border_color=ACCENT, width=None):
        Flowable.__init__(self)
        self.text = text
        self.bg = bg
        self.border_color = border_color
        self._width = width or 460
        self.height = 0
    def wrap(self, aW, aH):
        self._width = min(self._width, aW)
        p = Paragraph(self.text, ParagraphStyle('cb', fontName='FreeSerif', fontSize=11, leading=17, textColor=HEADER_FILL, alignment=TA_CENTER))
        w, h = p.wrap(self._width - 24, aH)
        self.height = h + 20
        self._para = p
        return self._width, self.height
    def draw(self):
        self.canv.setFillColor(self.bg)
        self.canv.roundRect(0, 0, self._width, self.height, 6, fill=1, stroke=0)
        self.canv.setStrokeColor(self.border_color)
        self.canv.setLineWidth(3)
        self.canv.line(0, 0, 0, self.height)
        self._para.drawOn(self.canv, 12, 10)

def make_table(headers, rows, col_widths=None):
    avail = 468
    if col_widths is None:
        n = len(headers)
        col_widths = [avail / n] * n
    else:
        total = sum(col_widths)
        col_widths = [w / total * avail for w in col_widths]

    data = [[Paragraph(h, sTableHead) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), sTableCell if i > 0 else sTableCellLeft) for i, c in enumerate(row)])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'FreeSerif-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t

def bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet> {text}', sBullet)

def heading(text):
    return Paragraph(text, sH1)

def subheading(text):
    return Paragraph(text, sH2)

def body(text):
    return Paragraph(text, sBody)

def body_left(text):
    return Paragraph(text, sBodyLeft)

# ━━ Build Document ━━
output_path = '/home/z/my-project/download/V-Swing_Capital_Deployment_Framework.pdf'
os.makedirs(os.path.dirname(output_path), exist_ok=True)

doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    leftMargin=55, rightMargin=55,
    topMargin=50, bottomMargin=50,
    title='V-Swing Capital Deployment & Rotation Framework',
    author='V-Swing Trading Desk',
    subject='Position Sizing, Monthly Allocation & Trade Rotation Plan',
)

story = []

# ──────────────────────────────────────
# CHAPTER 1: YOUR CAPITAL SNAPSHOT
# ──────────────────────────────────────
story.append(heading('1. Your Capital Snapshot'))
story.append(body(
    'Before deploying any capital, you must internalize your numbers. The V-Swing strategy is designed around '
    'strict risk management with a focus on capital preservation first and growth second. Every rupee you deploy '
    'should follow a calculated plan, not an emotional impulse. The table below captures your baseline configuration '
    'as set in the V-Swing Trading Desk app. These numbers form the foundation of every sizing, allocation, and '
    'rotation decision you will make during your paper trading phase and beyond.'
))

story.append(Spacer(1, 8))
story.append(make_table(
    ['Parameter', 'Value', 'What It Means'],
    [
        ['Total Trading Capital', 'Rs 2,00,000', 'Your entire risk pool for swing trading'],
        ['Risk Per Trade', '1.0% (Rs 2,000)', 'Maximum loss allowed on any single trade'],
        ['Max Concurrent Positions', '3', 'Maximum open trades at any given time'],
        ['Max Portfolio Slots', '8', 'Capital divided into 8 equal risk buckets'],
        ['Expected Trades / Month', '4 to 8', 'Moderate selectivity, not overtrading'],
        ['Average Holding Period', '5 to 15 days', 'Swing timeframe, not intraday or investment'],
        ['Min Confluence Score', '3 out of 6', 'Minimum quality threshold to consider a setup'],
        ['Min Risk:Reward', '1.5:1', 'Minimum R:R ratio to enter a trade'],
        ['Position Sizing Method', 'True Risk Hybrid', 'Combines risk-based and capital-based limits'],
    ],
    col_widths=[160, 90, 220],
))
story.append(Spacer(1, 10))

story.append(CalloutBox(
    '<b>Core Position Sizing Formula</b><br/>'
    'Qty = (Capital x Risk% x ddPenalty) / (Entry Price - Stop Loss)<br/>'
    'Capped by: Position Value &lt; Capital / MaxSlots'
))
story.append(Spacer(1, 6))
story.append(body(
    'The ddPenalty (drawdown risk penalty) automatically reduces your position sizes when your portfolio is in drawdown. '
    'The formula is: max(0.25, min(1.0, 1 - drawdown%/20)). At 10% drawdown, your penalty is 0.5x, meaning you trade '
    'at half your normal size. This self-correcting mechanism prevents you from blowing up during losing streaks and '
    'ensures you survive to trade another day. It is one of the most powerful features of the V-Swing system.'
))

# ──────────────────────────────────────
# CHAPTER 2: PER-TRADE POSITION SIZING
# ──────────────────────────────────────
story.append(heading('2. Per-Trade Position Sizing'))
story.append(body(
    'The V-Swing system uses a three-layer position sizing approach that balances risk control with profit potential. '
    'The first layer is risk-based sizing, which ensures no single trade can lose more than your defined risk percentage. '
    'The second layer is capital-based sizing, which prevents any single position from consuming too much of your portfolio. '
    'The third layer is the drawdown penalty, which dynamically shrinks your sizes when you are in a losing period. '
    'Your final position size is always the minimum of these three constraints, ensuring you never overexpose yourself.'
))

story.append(subheading('2.1 A+ Setup vs B Setup Sizing'))
story.append(body(
    'An A+ setup (all 6 confluence factors aligned) receives full risk allocation: 1% of capital per trade. A B setup '
    '(4-5 factors aligned) receives half risk allocation: 0.5% of capital per trade. This differential ensures that '
    'your capital is concentrated on the highest-probability setups while still allowing you to participate in good-but-not-perfect '
    'opportunities. Over time, this allocation difference compounds significantly in your favor.'
))

story.append(Spacer(1, 6))
story.append(make_table(
    ['Stock', 'Entry', 'SL', 'TP', 'R:R', 'Qty (A+)', 'Pos Value (A+)', 'Max Loss (A+)'],
    [
        ['RELIANCE', '2,950', '2,880', '3,100', '2.1x', '28', 'Rs 82,600', 'Rs 1,960'],
        ['TATAMOTORS', '980', '940', '1,040', '2.0x', '50', 'Rs 49,000', 'Rs 2,000'],
        ['ITC', '465', '448', '495', '2.0x', '117', 'Rs 54,405', 'Rs 1,989'],
    ],
    col_widths=[68, 48, 48, 48, 36, 52, 76, 76],
))
story.append(Spacer(1, 4))
story.append(Paragraph('<i>Examples based on Rs 2,00,000 capital, 1% risk, no drawdown (ddPenalty = 1.0x), max 8 slots.</i>', sSmall))

story.append(subheading('2.2 Pyramiding Rules'))
story.append(body(
    'The V-Swing backtester supports pyramiding (adding to a winning position). If your first entry is in profit and '
    'a new signal appears on the same stock, you can add up to 50% of your original quantity. This means if you '
    'initially bought 50 shares of TATAMOTORS and it moves in your favor, you can add 25 more shares at the new signal '
    'price. However, your stop loss adjusts to the latest entry, and your total risk should never exceed the original '
    '1% allocation. Pyramiding is only allowed on A+ setups and only when the first partial take-profit (30% exit at TP1) '
    'has already been secured. This rule ensures you only add to positions that are already proving you right.'
))

# ──────────────────────────────────────
# CHAPTER 3: MONTHLY CAPITAL DEPLOYMENT
# ──────────────────────────────────────
story.append(heading('3. Monthly Capital Deployment Plan'))
story.append(body(
    'The single biggest mistake new traders make is deploying all their capital on day one. This leads to forced '
    'decisions, poor entries, and psychological stress when multiple positions move against you simultaneously. '
    'The V-Swing deployment plan uses a time-based tranche system that spaces out your capital deployment across '
    'the trading month. This approach ensures you always have dry powder available for high-quality setups that '
    'appear later, and you are never caught fully invested during a market correction.'
))

story.append(subheading('3.1 Weekly Deployment Schedule'))
story.append(Spacer(1, 4))
story.append(make_table(
    ['Week', 'Deploy %', 'Max Open', 'Available Cash', 'Rules'],
    [
        ['Week 1', '30-40%', '1-2', 'Rs 1,20,000+', 'A+ setups only. Wait for 5+ score.'],
        ['Week 2', 'Up to 60%', '2-3', 'Rs 80,000+', 'Add B setups if A+ quality confirmed.'],
        ['Week 3', 'Up to 70%', '2-3', 'Rs 60,000+', 'Trail stops on Week 1 positions.'],
        ['Week 4', 'Wind down', '1-2', 'Reset to 60%+', 'Close matured trades, rotate capital.'],
    ],
    col_widths=[55, 55, 55, 80, 225],
))
story.append(Spacer(1, 6))

story.append(subheading('3.2 The 40% Cash Reserve Rule'))
story.append(body(
    'At any point in time, you should maintain at least 30-40% of your total capital in cash. This reserve serves '
    'three critical purposes. First, it gives you the ability to add to winning positions (pyramiding) when a trade '
    'moves in your favor. Second, it provides a psychological buffer that prevents you from feeling forced to enter '
    'suboptimal setups just because your money is sitting idle. Third, it acts as an emergency fund that allows '
    'you to absorb unexpected drawdowns without triggering the severe ddPenalty reduction. With Rs 2,00,000 capital, '
    'this means you should never have more than Rs 1,20,000 to Rs 1,40,000 deployed in open positions at any time, '
    'leaving Rs 60,000 to Rs 80,000 in reserve for new opportunities and risk absorption.'
))

# ──────────────────────────────────────
# CHAPTER 4: POSITION ROTATION FRAMEWORK
# ──────────────────────────────────────
story.append(heading('4. Position Rotation Framework'))
story.append(body(
    'Rotation is the process of closing existing positions and redeploying the freed capital into new setups. '
    'This is not the same as random buying and selling. Every rotation decision follows a clear rule based on '
    'the exit reason. Understanding these rules prevents you from making emotional decisions about when to exit '
    'and what to enter next. The V-Swing system defines four exit triggers, each with a specific rotation protocol.'
))

story.append(Spacer(1, 6))
story.append(make_table(
    ['Exit Trigger', 'What Happens', 'Rotation Action', 'Cooldown'],
    [
        ['TP1 Hit (30% exit)', '30% qty sold at target. Remainder trailed.', 'Hold remainder. No new entry needed.', 'None'],
        ['TP2 Hit (50% exit)', '50% of remaining sold. Trailing stop active.', 'Hold remainder until trailing stop or time exit.', 'None'],
        ['Stop Loss Hit', 'Full position closed at loss.', 'Wait for fresh setup. Do NOT re-enter same stock.', '1 bar (next day)'],
        ['Trailing Stop', 'EMA10 - ATR exit. Usually profitable.', 'Free up slot. Scan for new A+ setup.', '1 bar'],
        ['Dead Capital (25 bars)', 'Position showed no progress in 25 days.', 'Exit at market. Free up slot and capital.', 'None'],
    ],
    col_widths=[100, 130, 140, 70],
))
story.append(Spacer(1, 6))

story.append(subheading('4.1 Example Rotation Cycle'))
story.append(body(
    'Here is a concrete example of how rotation works across a typical month. In Week 1, you enter RELIANCE (A+ setup, '
    'Rs 82,600 deployed). In Week 2, TATAMOTORS triggers an A+ signal, so you deploy Rs 49,000 (total deployed: '
    'Rs 1,31,600 or 66%). In Week 2.5, RELIANCE hits TP1. You book 30% profit and trail the rest. In Week 3, '
    'RELIANCE hits trailing stop for a net +Rs 6,200 gain. This frees up Rs 82,600. You now scan for new setups '
    'with refreshed capital. ITC appears as a B setup in Week 3.5, you deploy Rs 54,000. ITC hits SL in Week 4 '
    'for a -Rs 1,989 loss. TATAMOTORS hits TP2 in Week 4 for a +Rs 4,500 gain. Net month P&L: +Rs 8,711 or +4.4% '
    'on deployed capital. This is a realistic scenario with one winner, one partial winner, and one loser.'
))

# ──────────────────────────────────────
# CHAPTER 5: WEEKLY OPERATING RHYTHM
# ──────────────────────────────────────
story.append(heading('5. Weekly Operating Rhythm'))
story.append(body(
    'Consistency in your trading routine is more important than any single trade decision. The weekly rhythm below '
    'gives you a structured playbook for every day of the trading week. By following this schedule, you remove '
    'decision fatigue and ensure that every aspect of your trading system is attended to at the right time. '
    'Monday is for scanning and planning. Tuesday through Wednesday are for execution. Thursday is for management. '
    'Friday is for review and journaling. This rhythm ensures you spend more time managing existing positions '
    'than hunting for new ones, which is the hallmark of a disciplined swing trader.'
))

story.append(Spacer(1, 6))
story.append(make_table(
    ['Day', 'Primary Action', 'V-Swing Tool', 'Time Needed'],
    [
        ['Monday', 'Run full screener scan. Review open positions. Update SL/TP levels.', 'Screener Tab + Live P&L', '20-30 min'],
        ['Tuesday', 'Enter new A+ setups from Monday scan. Set alerts.', 'Journal Tab (Quality Check)', '15-20 min'],
        ['Wednesday', 'Add B setups if max slots not full. Pyramid winners.', 'Screener + Sizing Tab', '10-15 min'],
        ['Thursday', 'Review trailing stops. Write journal entries for each open trade.', 'Journal Tab + Live P&L', '15-20 min'],
        ['Friday', 'Close TP1/SL trades. Review weekly P&L. Update drawdown %. Plan next week.', 'Analytics Tab + Sizing Tab', '20-30 min'],
    ],
    col_widths=[60, 220, 120, 60],
))
story.append(Spacer(1, 6))
story.append(body(
    'The total weekly time commitment is approximately 80-115 minutes, or about 15-20 minutes per trading day. '
    'This is deliberately designed to be sustainable. Swing trading is not a full-time job. If you find yourself '
    'spending more than 30 minutes per day, you are likely overtrading or overanalyzing. The V-Swing system is '
    'built to be mechanical: scan, check quality, enter, manage, exit. The less time you spend staring at screens, '
    'the better your decision-making will be. Use your free time to review journal entries, study past trades in '
    'the Analytics tab, and refine your understanding of market behavior rather than hunting for the next trade.'
))

# ──────────────────────────────────────
# CHAPTER 6: RISK GUARDRAILS
# ──────────────────────────────────────
story.append(heading('6. Risk Guardrails and Drawdown Protocol'))
story.append(body(
    'These are non-negotiable rules that protect your capital from catastrophic loss. They are encoded into the '
    'V-Swing Trading Desk app through the ddRiskPenalty formula and the trade quality checklist, but you must also '
    'internalize them as a trader. Breaking these rules is the number one reason retail traders blow up their '
    'accounts. The drawdown protocol is particularly important: it automatically reduces your position sizes as '
    'you lose, ensuring that the deeper you go into drawdown, the harder it becomes to lose more. This mathematical '
    'asymmetry is what keeps you in the game long enough for your edge to play out.'
))

story.append(Spacer(1, 6))
story.append(make_table(
    ['Drawdown Level', 'Action Required', 'Position Sizing Impact', 'Psychological Check'],
    [
        ['0-5% (Normal)', 'Trade normally. Full risk allocation.', 'ddPenalty = 1.0x (full size)', 'Stay calm, follow the plan.'],
        ['5-10% (Caution)', 'Reduce to B-setup sizing for all trades.', 'ddPenalty = 0.5x to 0.75x', 'Review last 5 trades for mistakes.'],
        ['10-15% (Warning)', 'Only A+ setups. Half normal size.', 'ddPenalty = 0.25x to 0.5x', 'Consider taking a 3-day break.'],
        ['15-20% (Critical)', 'Stop trading entirely. Journal review.', 'ddPenalty = 0.25x (floor)', 'Mandatory 1-week trading pause.'],
        ['20%+ (Emergency)', 'Close all positions. Full system reset.', 'Account review required', 'Seek mentorship. Paper trade again.'],
    ],
    col_widths=[85, 140, 120, 125],
))
story.append(Spacer(1, 6))

story.append(subheading('6.1 Hard Rules (Never Break)'))
story.append(bullet('<b>Never risk more than 2%</b> on a single trade, even on the most perfect A+ setup.'))
story.append(bullet('<b>Never hold more than 3 concurrent positions.</b> More positions = more correlation risk.'))
story.append(bullet('<b>Stop trading at 15% drawdown.</b> The market is telling you something is wrong.'))
story.append(bullet('<b>No revenge trades after 2 consecutive losses.</b> Take a mandatory 3-day break.'))
story.append(bullet('<b>Every trade must have a stop loss before entry.</b> The quality checklist enforces this.'))
story.append(bullet('<b>Never move your stop loss further away</b> from entry to "give the trade more room."'))
story.append(Spacer(1, 6))

story.append(CalloutBox(
    '<b>Drawdown Penalty Formula</b><br/>'
    'ddPenalty = max(0.25, min(1.0, 1 - Drawdown% / 20))<br/>'
    'At 0% DD: 1.0x (full size) | At 5% DD: 0.75x | At 10% DD: 0.5x | At 15% DD: 0.25x (floor)'
))

# ──────────────────────────────────────
# CHAPTER 7: PAPER TRADING ACTION PLAN
# ──────────────────────────────────────
story.append(heading('7. Paper Trading Action Plan'))
story.append(body(
    'Before risking real capital, you must prove to yourself that you can follow the system consistently. The '
    'V-Swing Trading Desk app is built specifically for this phase. Paper trading is not a simulation; it is a '
    'discipline test. If you cannot follow your own rules with fake money, you will certainly break them with '
    'real money. The plan below takes you from pure observation to full deployment over a 12-week period, '
    'gradually increasing your engagement level as you build confidence in the system and in your ability to '
    'execute it without emotional interference.'
))

story.append(Spacer(1, 6))
story.append(make_table(
    ['Phase', 'Duration', 'Activity', 'Success Criteria'],
    [
        ['1. Observe', 'Weeks 1-2', 'Run daily scans. Log signals in a notebook. Do NOT enter any trades.', 'Identify 10+ valid signals. Understand quality levels.'],
        ['2. Test', 'Weeks 3-4', 'Paper trade 1-2 positions max. Use quality checklist every time.', 'Complete 4-6 paper trades with full journal entries.'],
        ['3. Scale', 'Month 2', 'Increase to 2-3 concurrent positions. Track all metrics.', 'Maintain 50%+ win rate with 1.5:1 avg R:R.'],
        ['4. Deploy', 'Month 3', 'Full deployment: 3 concurrent, all features, weekly rhythm.', 'Positive expectancy confirmed. Max DD < 10%.'],
        ['5. Go Live', 'After Month 3', 'Start with 25% of real capital. Scale up over 3 months.', '3 months of profitable live trading before full capital.'],
    ],
    col_widths=[55, 62, 185, 168],
))
story.append(Spacer(1, 6))

story.append(subheading('7.1 Key Metrics to Track'))
story.append(body(
    'Throughout your paper trading phase, use the Analytics tab in the V-Swing Trading Desk to monitor these '
    'key performance indicators. Your goal before going live is to achieve: a win rate above 55%, an average '
    'risk-to-reward ratio above 1.8:1, a profit factor above 1.5, a maximum drawdown below 10%, and a Sharpe '
    'ratio above 1.0. These are not arbitrary targets. They represent the minimum statistical threshold at which '
    'the V-Swing strategy has a positive expected value over a large number of trades. If you are not meeting these '
    'targets after 50 paper trades, you should refine your setup selection (increase minScore to 4) or reduce your '
    'trade frequency rather than rushing to go live with real money.'
))
story.append(bullet('<b>Win Rate:</b> Percentage of closed trades with positive P&L. Target: 55%+'))
story.append(bullet('<b>Average R:R:</b> Average profit per winning trade divided by average loss per losing trade. Target: 1.8x+'))
story.append(bullet('<b>Profit Factor:</b> Total gross profit divided by total gross loss. Target: 1.5+'))
story.append(bullet('<b>Max Drawdown:</b> Largest peak-to-trough decline in portfolio value. Target: Below 10%'))
story.append(bullet('<b>Average Holding Period:</b> Mean number of days per trade. Expect 5-15 days for swing trades'))
story.append(bullet('<b>Expectancy:</b> (Win Rate x Avg Win) - (Loss Rate x Avg Loss). Must be positive.'))

# ──────────────────────────────────────
# BUILD
# ──────────────────────────────────────
def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont('FreeSerif', 8)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawCentredString(A4[0]/2, 25, f'V-Swing Capital Deployment Framework  |  Page {doc.page}')
    canvas.restoreState()

doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
print(f'PDF generated: {output_path}')
print(f'Size: {os.path.getsize(output_path)} bytes')