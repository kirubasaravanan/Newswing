/**
 * NSE Universe Scanner
 * 
 * Contains the full list of tradeable NSE stocks (F&O + large-cap + mid-cap)
 * and a lightweight L1 pre-filter to narrow 3000+ stocks down to ~100-200
 * candidates before running the expensive V-Swing engine (L2).
 * 
 * L1 Pre-filter criteria (lightweight, can run on daily close data):
 *   1. Price > ₹50 (avoid penny stocks)
 *   2. Daily volume > 100K (minimum liquidity)
 *   3. Close > SMA 50 (basic uptrend)
 *   4. RSI(14) 40-75 (not overbought, not dead)
 *   5. Price > EMA 20 (recent bullish)
 *   6. ADX > 18 OR rising (trending market)
 * 
 * Stocks passing L1 are then sent to the V-Swing engine for full 6-factor scoring.
 */

import type { OHLCV } from './screening-engine';
import { SMA, EMA, RSI, ADX } from 'technicalindicators';

// ── NSE Stock Universe ────────────────────────────────────

export interface NSEStock {
  symbol: string;
  name: string;
  sector: string;
  category: 'FNO' | 'LARGECAP' | 'MIDCAP' | 'SMALLCAP';
}

/**
 * NSE F&O Stocks (most liquid, ~185 stocks)
 * These are the primary universe for swing trading.
 */
export const NSE_FNO_STOCKS: NSEStock[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', category: 'FNO' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', category: 'FNO' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', category: 'FNO' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', category: 'FNO' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', category: 'FNO' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', category: 'FNO' },
  { symbol: 'ITC', name: 'ITC Limited', sector: 'FMCG', category: 'FNO' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Infrastructure', category: 'FNO' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', category: 'FNO' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto', category: 'FNO' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Finance', category: 'FNO' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto', category: 'FNO' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharma', sector: 'Pharma', category: 'FNO' },
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals', category: 'FNO' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'Conglomerate', category: 'FNO' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer', category: 'FNO' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', category: 'FNO' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Finance', category: 'FNO' },
  { symbol: 'DMART', name: 'Avenue Supermarts', sector: 'Retail', category: 'FNO' },
  { symbol: 'DIVISLAB', name: 'Divi Laboratories', sector: 'Pharma', category: 'FNO' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer', category: 'FNO' },
  { symbol: 'POWERGRID', name: 'Power Grid Corp', sector: 'Power', category: 'FNO' },
  { symbol: 'NTPC', name: 'NTPC Limited', sector: 'Power', category: 'FNO' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement', category: 'FNO' },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', category: 'FNO' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals', category: 'FNO' },
  { symbol: 'DRREDDY', name: "Dr Reddy's Labs", sector: 'Pharma', category: 'FNO' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp', sector: 'Energy', category: 'FNO' },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Mining', category: 'FNO' },
  { symbol: 'BPCL', name: 'Bharat Petroleum', sector: 'Energy', category: 'FNO' },
  { symbol: 'HINDPETRO', name: 'Hindustan Petroleum', sector: 'Energy', category: 'FNO' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG', category: 'FNO' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'Auto', category: 'FNO' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'Auto', category: 'FNO' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'Auto', category: 'FNO' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', sector: 'Healthcare', category: 'FNO' },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'Pharma', category: 'FNO' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance', sector: 'Insurance', category: 'FNO' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', sector: 'Insurance', category: 'FNO' },
  { symbol: 'BAJAJAUTO', name: 'Bajaj Auto', sector: 'Auto', category: 'FNO' },
  { symbol: 'DABUR', name: 'Dabur India', sector: 'FMCG', category: 'FNO' },
  { symbol: 'PIDILITIND', name: 'Pidilite Industries', sector: 'Chemicals', category: 'FNO' },
  { symbol: 'VEDL', name: 'Vedanta Limited', sector: 'Metals', category: 'FNO' },
  { symbol: 'TATAPOWER', name: 'Tata Power', sector: 'Power', category: 'FNO' },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'Cement', category: 'FNO' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'HDFCAMC', name: 'HDFC AMC', sector: 'AMC', category: 'FNO' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals', category: 'FNO' },
  { symbol: 'TRENT', name: 'Trent Limited', sector: 'Retail', category: 'FNO' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports', sector: 'Infrastructure', category: 'FNO' },
  { symbol: 'WELSPUNLIV', name: 'Welspun Living', sector: 'Textiles', category: 'FNO' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer', sector: 'FMCG', category: 'FNO' },
  { symbol: 'BERGEPAINT', name: 'Berger Paints', sector: 'Consumer', category: 'FNO' },
  { symbol: 'GODREJCP', name: 'Godrej Consumer', sector: 'FMCG', category: 'FNO' },
  { symbol: 'AMBUJACEM', name: 'Ambuja Cements', sector: 'Cement', category: 'FNO' },
  { symbol: 'ACC', name: 'ACC Limited', sector: 'Cement', category: 'FNO' },
  { symbol: 'SHREECEM', name: 'Shree Cement', sector: 'Cement', category: 'FNO' },
  { symbol: 'SIEMENS', name: 'Siemens India', sector: 'Industrial', category: 'FNO' },
  { symbol: 'ABB', name: 'ABB India', sector: 'Industrial', category: 'FNO' },
  // L&T removed — duplicate of LT (line 46)
  { symbol: 'BOSCHLTD', name: 'Bosch Limited', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'MOTHERSON', name: 'Motherson Sumi', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'MRF', name: 'MRF Tyres', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'BALKRISIND', name: 'Balkrishna Industries', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'PAGEIND', name: 'Page Industries', sector: 'Consumer', category: 'FNO' },
  { symbol: 'CHOLAFIN', name: 'Chola Financial', sector: 'Finance', category: 'FNO' },
  { symbol: 'PEL', name: 'Phantom Electronics', sector: 'Consumer Durables', category: 'FNO' },
  { symbol: 'CROMPTON', name: 'Crompton Greaves', sector: 'Consumer Durables', category: 'FNO' },
  { symbol: 'BATAINDIA', name: 'Bata India', sector: 'Retail', category: 'FNO' },
  { symbol: 'VBL', name: 'Varun Beverages', sector: 'FMCG', category: 'FNO' },
  { symbol: 'LAURUSLABS', name: 'Laurus Labs', sector: 'Pharma', category: 'FNO' },
  { symbol: 'ALKEM', name: 'Alkem Laboratories', sector: 'Pharma', category: 'FNO' },
  { symbol: 'LUPIN', name: 'Lupin Limited', sector: 'Pharma', category: 'FNO' },
  { symbol: 'AUROPHARMA', name: 'Aurobindo Pharma', sector: 'Pharma', category: 'FNO' },
  { symbol: 'BIOCON', name: 'Biocon', sector: 'Pharma', category: 'FNO' },
  { symbol: 'ZYDUSLIFE', name: 'Zydus Lifesciences', sector: 'Pharma', category: 'FNO' },
  { symbol: 'IPCALAB', name: 'Ipca Laboratories', sector: 'Pharma', category: 'FNO' },
  { symbol: 'TORNTPOWER', name: 'Torrent Power', sector: 'Power', category: 'FNO' },
  { symbol: 'TATAELXSI', name: 'Tata Elxsi', sector: 'IT', category: 'FNO' },
  { symbol: 'COFORGE', name: 'Coforge', sector: 'IT', category: 'FNO' },
  { symbol: 'PERSISTENT', name: 'Persistent Systems', sector: 'IT', category: 'FNO' },
  { symbol: 'MPHASIS', name: 'Mphasis', sector: 'IT', category: 'FNO' },
  { symbol: 'LTIM', name: 'LTIMindtree', sector: 'IT', category: 'FNO' },
  { symbol: 'JSWINFRA', name: 'JSW Infrastructure', sector: 'Infrastructure', category: 'FNO' },
  { symbol: 'KEI', name: 'KEI Industries', sector: 'Electrical', category: 'FNO' },
  { symbol: 'POLYCAB', name: 'Polycab India', sector: 'Electrical', category: 'FNO' },
  { symbol: 'DEEPAKNTR', name: 'Deepak Nitrite', sector: 'Chemicals', category: 'FNO' },
  { symbol: 'SRF', name: 'SRF Limited', sector: 'Chemicals', category: 'FNO' },
  { symbol: 'AARTIDRUG', name: 'Aarti Drugs', sector: 'Pharma', category: 'FNO' },
  { symbol: 'TORNTPHARM', name: 'Torrent Pharma', sector: 'Pharma', category: 'FNO' },
  { symbol: 'LALPATHLAB', name: 'Lal PathLabs', sector: 'Healthcare', category: 'FNO' },
  { symbol: 'MAXHEALTH', name: 'Max Healthcare', sector: 'Healthcare', category: 'FNO' },
  { symbol: 'NHPC', name: 'NHPC Limited', sector: 'Power', category: 'FNO' },
  { symbol: 'SJVN', name: 'SJVN Limited', sector: 'Power', category: 'FNO' },
  { symbol: 'NALCO', name: 'NALCO', sector: 'Metals', category: 'FNO' },
  { symbol: 'NMDC', name: 'NMDC Limited', sector: 'Mining', category: 'FNO' },
  { symbol: 'IOC', name: 'Indian Oil Corp', sector: 'Energy', category: 'FNO' },
  { symbol: 'BPCL', name: 'Bharat Petroleum', sector: 'Energy', category: 'FNO' },
  { symbol: 'IGL', name: 'Indraprastha Gas', sector: 'Gas', category: 'FNO' },
  { symbol: 'MGL', name: 'Mahanagar Gas', sector: 'Gas', category: 'FNO' },
  { symbol: 'PETRONET', name: 'Petronet LNG', sector: 'Gas', category: 'FNO' },
  { symbol: 'GUJGASLTD', name: 'Gujarat Gas', sector: 'Gas', category: 'FNO' },
  { symbol: 'CHOLAHLDNG', name: 'Chola Holdings', sector: 'Finance', category: 'FNO' },
  { symbol: 'IBULHSGFIN', name: 'IBUL Housing Finance', sector: 'Finance', category: 'FNO' },
  { symbol: 'CANBK', name: 'Canara Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'PNB', name: 'Punjab National Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda', sector: 'Banking', category: 'FNO' },
  { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'PNBHFL', name: 'PNB Housing', sector: 'Housing Finance', category: 'FNO' },
  { symbol: 'LICHSGFIN', name: 'LIC Housing Finance', sector: 'Housing Finance', category: 'FNO' },
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals', category: 'FNO' },
  { symbol: 'HINDCOPPER', name: 'Hindustan Copper', sector: 'Metals', category: 'FNO' },
  { symbol: 'NATIONALUM', name: 'National Aluminium', sector: 'Metals', category: 'FNO' },
  { symbol: 'NMDC', name: 'NMDC', sector: 'Mining', category: 'FNO' },
  { symbol: 'RVNL', name: 'Rail Vikas Nigam', sector: 'Infrastructure', category: 'FNO' },
  { symbol: 'IRFC', name: 'IRFC', sector: 'Finance', category: 'FNO' },
  { symbol: 'IRCTC', name: 'IRCTC', sector: 'Travel', category: 'FNO' },
  { symbol: 'RECLTD', name: 'REC Limited', sector: 'Power', category: 'FNO' },
  { symbol: 'PFC', name: 'PFC Limited', sector: 'Power', category: 'FNO' },
  { symbol: 'NTPC', name: 'NTPC', sector: 'Power', category: 'FNO' },
  { symbol: 'CDSL', name: 'CDSL', sector: 'Finance', category: 'FNO' },
  { symbol: 'ISEC', name: 'Indian Energy Exchange', sector: 'Power', category: 'FNO' },
  { symbol: 'EXIDEIND', name: 'Exide Industries', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'TVSMOTOR', name: 'TVS Motor', sector: 'Auto', category: 'FNO' },
  { symbol: 'ESCORTS', name: 'Escorts Kubota', sector: 'Auto', category: 'FNO' },
  { symbol: 'CUETFINANCE', name: 'Cue Financial', sector: 'Finance', category: 'FNO' },
  { symbol: 'ICICIGI', name: 'ICICI General Insurance', sector: 'Insurance', category: 'FNO' },
  { symbol: 'CAREERP', name: 'CARE Ratings', sector: 'Finance', category: 'FNO' },
  { symbol: 'FACT', name: 'FACT', sector: 'Chemicals', category: 'FNO' },
  { symbol: 'RCF', name: 'Rashtriya Chemicals', sector: 'Chemicals', category: 'FNO' },
  { symbol: 'CHAMBLFERT', name: 'Chambal Fertilisers', sector: 'Fertilisers', category: 'FNO' },
  { symbol: 'GNFC', name: 'Gujarat Narmada', sector: 'Fertilisers', category: 'FNO' },
  { symbol: 'COROMANDEL', name: 'Coromandel International', sector: 'Fertilisers', category: 'FNO' },
  { symbol: 'UPL', name: 'UPL Limited', sector: 'Agri Chemicals', category: 'FNO' },
  { symbol: 'RAJESHEXPO', name: 'Rajesh Exports', sector: 'Jewellery', category: 'FNO' },
  { symbol: 'MANAPPURAM', name: 'Manappuram Finance', sector: 'NBFC', category: 'FNO' },
  { symbol: 'MUTHOOTFIN', name: 'Muthoot Finance', sector: 'NBFC', category: 'FNO' },
  { symbol: 'BAJAJHLDNG', name: 'Bajaj Holdings', sector: 'Conglomerate', category: 'FNO' },
  { symbol: 'ADANITRANS', name: 'Adani Total Gas', sector: 'Gas', category: 'FNO' },
  { symbol: 'ADANIGREEN', name: 'Adani Green Energy', sector: 'Power', category: 'FNO' },
  { symbol: 'ADANIPOWER', name: 'Adani Power', sector: 'Power', category: 'FNO' },
  { symbol: 'WAAREEENER', name: 'Waaree Energies', sector: 'Solar', category: 'FNO' },
  { symbol: 'PREMIERENE', name: 'Premier Energies', sector: 'Solar', category: 'FNO' },
  { symbol: 'TATAPOWER', name: 'Tata Power', sector: 'Power', category: 'FNO' },
  { symbol: 'Suzlon', name: 'Suzlon Energy', sector: 'Wind Energy', category: 'FNO' },
  { symbol: 'INDIAMART', name: 'IndiaMART InterMESH', sector: 'Internet', category: 'FNO' },
  { symbol: 'FIVESTAR', name: 'Five-Star Business Finance', sector: 'NBFC', category: 'FNO' },
  { symbol: 'JYOTHYLAB', name: 'Jyothy Labs', sector: 'FMCG', category: 'FNO' },
  { symbol: 'EMAMI', name: 'Emami Limited', sector: 'FMCG', category: 'FNO' },
  { symbol: 'MARICO', name: 'Marico Limited', sector: 'FMCG', category: 'FNO' },
  { symbol: 'GODREJAGRO', name: 'Godrej Agrovet', sector: 'Agri', category: 'FNO' },
  { symbol: 'BALRAMCHIN', name: 'Balarampur Chini', sector: 'Sugar', category: 'FNO' },
  { symbol: 'TRIDENT', name: 'Trident', sector: 'Textiles', category: 'FNO' },
  { symbol: 'RAYMOND', name: 'Raymond', sector: 'Textiles', category: 'FNO' },
  { symbol: 'VARDHMAN', name: 'Vardhman Textiles', sector: 'Textiles', category: 'FNO' },
  { symbol: 'GILLETTE', name: 'Gillette India', sector: 'FMCG', category: 'FNO' },
  { symbol: 'COLPAL', name: 'Colgate Palmolive', sector: 'FMCG', category: 'FNO' },
  { symbol: 'HONAUT', name: 'Honeywell Auto', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'ENDURANCE', name: 'Endurance Technologies', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'SAMVARDHNA', name: 'Samvardhana Motherson', sector: 'Auto Ancillary', category: 'FNO' },
  { symbol: 'MINDTREE', name: 'LTIMindtree', sector: 'IT', category: 'FNO' },
  { symbol: 'DATAMATI', name: 'Datamatics Global', sector: 'IT', category: 'FNO' },
  { symbol: 'KFINTECH', name: 'Kfintech', sector: 'Finance', category: 'FNO' },
  { symbol: 'TATAINVEST', name: 'Tata Investment Corp', sector: 'Finance', category: 'FNO' },
  { symbol: 'FLUOROCHEM', name: 'Fluorochem', sector: 'Chemicals', category: 'FNO' },
  { symbol: 'SOLARINDS', name: 'Solar Industries', sector: 'Defence', category: 'FNO' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics', sector: 'Defence', category: 'FNO' },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'Defence', category: 'FNO' },
  { symbol: 'BEML', name: 'BEML Limited', sector: 'Defence', category: 'FNO' },
  { symbol: 'Mazdock', name: 'Mazagon Dock', sector: 'Defence', category: 'FNO' },
  { symbol: 'BHEL', name: 'Bharat Heavy Electricals', sector: 'Power', category: 'FNO' },
  { symbol: 'CUMMINSIND', name: 'Cummins India', sector: 'Industrial', category: 'FNO' },
  { symbol: 'THERMAX', name: 'Thermax Limited', sector: 'Industrial', category: 'FNO' },
  { symbol: 'HAVELLS', name: 'Havells India', sector: 'Electrical', category: 'FNO' },
  { symbol: 'V-GUARD', name: 'V-Guard Industries', sector: 'Electrical', category: 'FNO' },
  { symbol: 'SYMBO', name: 'Symbo Pharma', sector: 'Pharma', category: 'FNO' },
  { symbol: 'TORNTPOWER', name: 'Torrent Power', sector: 'Power', category: 'FNO' },
  { symbol: 'KPRMILL', name: 'KPR Mill', sector: 'Textiles', category: 'FNO' },
  { symbol: 'ZENSARTECH', name: 'Zensar Technologies', sector: 'IT', category: 'FNO' },
  { symbol: 'ORIENTELEC', name: 'Orient Electric', sector: 'Electrical', category: 'FNO' },
  { symbol: 'BLUEDART', name: 'Blue Dart Express', sector: 'Logistics', category: 'FNO' },
  { symbol: 'DELHIVERY', name: 'Delhivery', sector: 'Logistics', category: 'FNO' },
  { symbol: 'DALBHARAT', name: 'DALBHARAT', sector: 'Engineering', category: 'FNO' },
  { symbol: 'KNRCON', name: 'KNR Constructions', sector: 'Infrastructure', category: 'FNO' },
  { symbol: 'ASHOKLEY', name: 'Ashok Leyland', sector: 'Auto', category: 'FNO' },
  { symbol: 'VOLVO', name: 'Eicher Motors', sector: 'Auto', category: 'FNO' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer', category: 'FNO' },
  { symbol: 'WHIRLPOOL', name: 'Whirlpool India', sector: 'Consumer Durables', category: 'FNO' },
  { symbol: 'VOLTAS', name: 'Voltas', sector: 'Consumer Durables', category: 'FNO' },
  { symbol: 'BLUESTAR', name: 'Blue Star', sector: 'Consumer Durables', category: 'FNO' },
  { symbol: 'AUBANK', name: 'AU Small Finance Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'DCBBANK', name: 'DCB Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'J&KBANK', name: 'J&K Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'Banking', category: 'FNO' },
  { symbol: 'YESBANK', name: 'Yes Bank', sector: 'Banking', category: 'FNO' },
];

/**
 * Additional high-quality mid-cap stocks (beyond F&O)
 * Good growth potential, decent liquidity
 */
export const NSE_MIDCAP_STOCKS: NSEStock[] = [
  { symbol: 'DEEPAKNTR', name: 'Deepak Nitrite', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'AARTIIND', name: 'Aarti Industries', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'NAVINFLUOR', name: 'Navin Fluorine', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'SRF', name: 'SRF Limited', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'CUMMINSIND', name: 'Cummins India', sector: 'Industrial', category: 'MIDCAP' },
  { symbol: 'THERMAX', name: 'Thermax', sector: 'Industrial', category: 'MIDCAP' },
  { symbol: 'LUMAXIND', name: 'Lumax Industries', sector: 'Auto Ancillary', category: 'MIDCAP' },
  { symbol: 'BHARATFORG', name: 'Bharat Forge', sector: 'Auto Ancillary', category: 'MIDCAP' },
  { symbol: 'AMARA RAJA', name: 'Amara Raja Batteries', sector: 'Auto Ancillary', category: 'MIDCAP' },
  { symbol: 'EXIDEIND', name: 'Exide Industries', sector: 'Auto Ancillary', category: 'MIDCAP' },
  { symbol: 'DENORA', name: 'Denora', sector: 'Industrial', category: 'MIDCAP' },
  { symbol: 'ATUL', name: 'Atul Limited', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'CLEAN', name: 'Clean Science', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'FINEORG', name: 'Fine Organics', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'VINATIORGA', name: 'Vinati Organics', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'KRBL', name: 'KRBL Limited', sector: 'FMCG', category: 'MIDCAP' },
  { symbol: 'RATNAMANI', name: 'Ratnamani Metals', sector: 'Metals', category: 'MIDCAP' },
  { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', sector: 'NBFC', category: 'MIDCAP' },
  { symbol: 'CHOLAFIN', name: 'Cholamandalam Finance', sector: 'NBFC', category: 'MIDCAP' },
  { symbol: 'MAHABANK', name: 'Bank of Maharashtra', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'INDIANB', name: 'Indian Bank', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'UNIONBANK', name: 'Union Bank of India', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'IOB', name: 'Indian Overseas Bank', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'UCOBANK', name: 'UCO Bank', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'PNB', name: 'Punjab National Bank', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'CENTRALBK', name: 'Central Bank of India', sector: 'Banking', category: 'MIDCAP' },
  { symbol: 'TV18BRDCST', name: 'TV18 Broadcast', sector: 'Media', category: 'MIDCAP' },
  { symbol: 'ZEEL', name: 'Zee Entertainment', sector: 'Media', category: 'MIDCAP' },
  { symbol: 'PVRINOX', name: 'PVR INOX', sector: 'Entertainment', category: 'MIDCAP' },
  { symbol: 'DELTA', name: 'Delta Corp', sector: 'Gaming', category: 'MIDCAP' },
  { symbol: 'NYKAA', name: 'Nykaa', sector: 'E-commerce', category: 'MIDCAP' },
  { symbol: 'ZOMATO', name: 'Zomato', sector: 'Food Delivery', category: 'MIDCAP' },
  { symbol: 'PB FINT', name: 'PB Fintech', sector: 'Fintech', category: 'MIDCAP' },
  { symbol: 'ONE 97', name: 'Paytm', sector: 'Fintech', category: 'MIDCAP' },
  { symbol: 'FSN ECOM', name: 'Nykaa FSN', sector: 'E-commerce', category: 'MIDCAP' },
  { symbol: 'DRAGONFLY', name: 'Aether Industries', sector: 'Chemicals', category: 'MIDCAP' },
  { symbol: 'ELECON', name: 'Elecon Engineering', sector: 'Industrial', category: 'MIDCAP' },
  { symbol: 'SUPREMEIND', name: 'Supreme Industries', sector: 'Plastics', category: 'MIDCAP' },
  { symbol: 'PGHL', name: 'PG Electroplast', sector: 'Electronics', category: 'MIDCAP' },
  { symbol: 'Syrma SGS', name: 'Syrma SGS Tech', sector: 'Electronics', category: 'MIDCAP' },
  { symbol: 'DIXON', name: 'Dixon Technologies', sector: 'Electronics', category: 'MIDCAP' },
  { symbol: 'AMBER', name: 'Amber Enterprises', sector: 'Electronics', category: 'MIDCAP' },
  { symbol: 'ROBYTELEC', name: 'Roby Tech', sector: 'Electronics', category: 'MIDCAP' },
  { symbol: 'HAPPSTMNDS', name: 'Happy Forgings', sector: 'Auto Ancillary', category: 'MIDCAP' },
  { symbol: 'GET&D', name: 'Get & D', sector: 'Auto Ancillary', category: 'MIDCAP' },
  { symbol: 'SONATSOFTW', name: 'Sonata Software', sector: 'IT', category: 'MIDCAP' },
  { symbol: 'KNRCON', name: 'KNR Constructions', sector: 'Infrastructure', category: 'MIDCAP' },
  { symbol: 'NCC', name: 'NCC Limited', sector: 'Infrastructure', category: 'MIDCAP' },
];

/**
 * Full universe = FNO + Mid-cap (deduped)
 */
export function getFullUniverse(): NSEStock[] {
  const seen = new Set<string>();
  const universe: NSEStock[] = [];
  
  for (const stock of [...NSE_FNO_STOCKS, ...NSE_MIDCAP_STOCKS]) {
    if (!seen.has(stock.symbol)) {
      seen.add(stock.symbol);
      universe.push(stock);
    }
  }
  return universe;
}

// ── L1 Pre-Filter ─────────────────────────────────────────

export interface L1FilterResult {
  symbol: string;
  name: string;
  sector: string;
  category: string;
  passed: boolean;
  closePrice: number;
  sma50: number;
  ema20: number;
  rsi14: number;
  adx: number;
  dailyVolume: number;
  volumeMA20: number;
  failReason?: string;
}

/**
 * Lightweight L1 pre-filter.
 * Runs fast indicators (SMA50, EMA20, RSI14, ADX14) to eliminate
 * stocks that clearly don't have swing-trade potential.
 * 
 * Returns only stocks that pass ALL basic criteria.
 */
export function runL1Filter(
  symbol: string,
  name: string,
  sector: string,
  category: string,
  candles: OHLCV[]
): L1FilterResult | null {
  if (candles.length < 60) {
    return null; // Not enough data
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const currentClose = closes[closes.length - 1];
  const currentVolume = volumes[volumes.length - 1];

  // Filter 1: Minimum price ₹50
  if (currentClose < 50) {
    return { symbol, name, sector, category, passed: false, closePrice: currentClose, sma50: 0, ema20: 0, rsi14: 0, adx: 0, dailyVolume: currentVolume, volumeMA20: 0, failReason: 'Price < ₹50' };
  }

  // Calculate indicators
  const sma50Arr = SMA.calculate({ period: 50, values: closes });
  const ema20Arr = EMA.calculate({ period: 20, values: closes });
  const rsi14Arr = RSI.calculate({ period: 14, values: closes });
  const adxResult = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

  if (sma50Arr.length === 0 || ema20Arr.length === 0 || rsi14Arr.length === 0 || adxResult.length === 0) {
    return null;
  }

  const sma50 = sma50Arr[sma50Arr.length - 1];
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const rsi14 = rsi14Arr[rsi14Arr.length - 1];
  const adxData = adxResult[adxResult.length - 1];
  const adx = adxData.adx;
  const prevAdx = adxResult.length > 1 ? adxResult[adxResult.length - 2].adx : 0;

  // Volume MA 20
  const recentVolumes = volumes.slice(-21);
  const volumeMA20 = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

  const baseResult = {
    symbol, name, sector, category, passed: false,
    closePrice: currentClose, sma50, ema20, rsi14, adx,
    dailyVolume: currentVolume, volumeMA20,
  };

  // Filter 2: Minimum daily volume 100K
  if (currentVolume < 100000) {
    return { ...baseResult, failReason: `Low volume: ${(currentVolume/1000).toFixed(0)}K` };
  }

  // Filter 3: Close > SMA 50 (basic uptrend)
  if (currentClose <= sma50) {
    return { ...baseResult, failReason: 'Below SMA 50' };
  }

  // Filter 4: RSI between 40-75
  if (rsi14 < 40 || rsi14 > 75) {
    return { ...baseResult, failReason: `RSI ${rsi14.toFixed(1)} out of range` };
  }

  // Filter 5: Close > EMA 20
  if (currentClose <= ema20) {
    return { ...baseResult, failReason: 'Below EMA 20' };
  }

  // Filter 6: Trending (ADX > 18 OR rising)
  const adxRising = adx > prevAdx;
  if (adx < 18 && !adxRising) {
    return { ...baseResult, failReason: `Low ADX: ${adx.toFixed(1)}` };
  }

  return { ...baseResult, passed: true };
}