/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import __Layout from './Layout.jsx';
import { lazyWithRetry } from './lib/lazyWithRetry';

const Analytics = lazyWithRetry(() => import('./pages/Analytics'));
const Archive = lazyWithRetry(() => import('./pages/Archive'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Dungeon = lazyWithRetry(() => import('./pages/Dungeon'));
const Focus = lazyWithRetry(() => import('./pages/Focus'));
const Landing = lazyWithRetry(() => import('./pages/Landing'));
const Leaderboard = lazyWithRetry(() => import('./pages/Leaderboard'));
const Profile = lazyWithRetry(() => import('./pages/Profile'));
const Insights = lazyWithRetry(() => import('./pages/Insights'));
const PartyChallenges = lazyWithRetry(() => import('./pages/PartyChallenges'));
const Recovery = lazyWithRetry(() => import('./pages/Recovery'));
const Community = lazyWithRetry(() => import('./pages/Community'));
const PaymentVerification = lazyWithRetry(() => import('./pages/PaymentVerification'));
const Quests = lazyWithRetry(() => import('./pages/Quests'));
const RedeemCodes = lazyWithRetry(() => import('./pages/RedeemCodes'));
const Relics = lazyWithRetry(() => import('./pages/Relics'));
const Habits = lazyWithRetry(() => import('./pages/Habits'));
const Login = lazyWithRetry(() => import('./pages/Login'));
const Punishments = lazyWithRetry(() => import('./pages/Punishments'));


export const PAGES = {
    "Analytics": Analytics,
    "Archive": Archive,
    "Dashboard": Dashboard,
    "Dungeon": Dungeon,
    "Focus": Focus,
    "Landing": Landing,
    "Leaderboard": Leaderboard,
    "Profile": Profile,
    "Insights": Insights,
    "PartyChallenges": PartyChallenges,
    "Recovery": Recovery,
    "Community": Community,
    "PaymentVerification": PaymentVerification,
    "Quests": Quests,
    "RedeemCodes": RedeemCodes,
    "Relics": Relics,
    "Habits": Habits,
    "Login": Login,
    "Punishments": Punishments,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
