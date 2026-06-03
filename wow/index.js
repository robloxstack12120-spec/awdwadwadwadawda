(function () {
"use strict";

// ─── Vendetta / Kettu Mobile APIs ────────────────────────────────────────
var React = vendetta.metro.common.React;
var RN = vendetta.metro.common.ReactNative;
var View = RN.View;
var Text = RN.Text;
var TextInput = RN.TextInput;
var ScrollView = RN.ScrollView;
var TouchableOpacity = RN.TouchableOpacity;
var Pressable = RN.Pressable || RN.TouchableOpacity;
var Image = RN.Image;
var findByStoreName = vendetta.metro.findByStoreName;
var findByName = vendetta.metro.findByName;
var findByProps = vendetta.metro.findByProps;
var after = vendetta.patcher.after;
var before = vendetta.patcher.before;
var instead = vendetta.patcher.instead;
var showToast = vendetta.ui.toasts.showToast;
var getAssetIDByName = vendetta.ui.assets.getAssetIDByName;
var storage = vendetta.plugin.storage;

if (!Array.isArray(storage.aliases)) storage.aliases = [];
if (storage.enabled == null) storage.enabled = true;

// ─── Discord Stores & Utilities ──────────────────────────────────────────
var UserStore = findByStoreName("UserStore");
var UserProfileStore = findByStoreName("UserProfileStore");
var GuildMemberStore = findByStoreName("GuildMemberStore");
var PresenceStore = findByStoreName("PresenceStore");
var FluxDispatcher = vendetta.metro.common.Flux
    ? vendetta.metro.common.Flux._currentDispatcher
    : findByProps("_currentDispatcher", "dispatch");
var IconUtils = findByProps("getUserAvatarURL");
var SnowflakeUtils = findByProps("extractTimestamp");
var UsernameUtils = findByProps("getName", "getGlobalName");
var DisplayProfileUtils = findByProps("getDisplayProfile", "useDisplayProfile");
var Constants = findByProps("Endpoints", "API_VERSION");
var RestAPI = findByProps("get", "post", "put", "patch", "delete")
    || findByProps("getAPIBaseURL");
var ChannelStore = findByStoreName("ChannelStore");
var GuildStore = findByStoreName("GuildStore");
var SelectedChannelStore = findByStoreName("SelectedChannelStore");
var userFlags = findByProps("Staff", "Partner", "HypeSquadEvents", "BugHunter", "Premium", "VerifiedDeveloper") || {};

// ─── State Maps ──────────────────────────────────────────────────────────
var mirrorTargetToSourceId = new Map();
var sourceUsersByTargetId = new Map();
var sourceProfilesByTargetId = new Map();
var sourceSnapshotsByTargetId = new Map();
var aliasedProfiles = new Map();
var aliasedUserViews = new Map();
var aliasedCurrentUserViews = new Map();
var aliasProxyToUnderlying = new WeakMap();
var cachedUsersById = new Map();
var cachedProfilesByUserId = new Map();
var cachedGuildMembersByKey = new Map();
var cachedAliasedProfileResponsesByRequestKey = new Map();
var inFlightUserFetches = new Map();
var inFlightProfileFetches = new Map();
var activeSourceUserIds = new Set();
var activeProfileUserIds = new Set();
var unavailableUsers = new Map();
var unavailableProfiles = new Map();
var preferredTargetUserIdsBySourceId = new Map();
var lastKnownGuildContextByUserId = new Map();
var lastPresenceRequestBySourceUserId = new Map();

var suppressUserUpdateEvents = 0;
var isSyncing = false;
var syncQueued = false;
var inGetAliasedUserView = 0;
var nextRestRequestAt = 0;
var restQueue = Promise.resolve();

var restSpacingMs = 600;
var rateLimitRetryMs = 300000;
var profileRetryMs = 60000;
var unavailableProfileRetryMs = 1800000;
var aliasProfileCacheTtlMs = 120000;
var presenceCooldownMs = 15000;
var presenceBatchSize = 100;

var patches = [];
var patchedUserPrototype = null;
var originalPrototypeGetAvatarURL = null;
var originalPrototypeGetAvatarSource = null;

// ─── CDN & Badge Constants ───────────────────────────────────────────────
var CDN = "https://cdn.discordapp.com";

var FALLBACK_BADGES = {
    active_developer: { id: "active_developer", description: "Active Developer", icon: "6bdc42827a38498929a4920da12695d9", link: "https://support-dev.discord.com/hc/en-us/articles/10113997751447" },
    bug_hunter_level_1: { id: "bug_hunter_level_1", description: "Discord Bug Hunter", icon: "2717692c7dca7289b35297368a940dd0", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" },
    bug_hunter_level_2: { id: "bug_hunter_level_2", description: "Discord Bug Hunter", icon: "848f79194d4be5ff5f81505cbd0ce1e6", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" },
    certified_moderator: { id: "certified_moderator", description: "Moderator Programs Alumni", icon: "fee1624003e2fee35cb398e125dc479b", link: "https://discord.com/safety" },
    discord_employee: { id: "staff", description: "Discord Staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d", link: "https://discord.com/company" },
    hypesquad: { id: "hypesquad", description: "HypeSquad Events", icon: "bf01d1073931f921909045f3a39fd264", link: "https://discord.com/hypesquad" },
    hypesquad_online_house_1: { id: "hypesquad_house_1", description: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02", link: "https://discord.com/settings/hypesquad-online" },
    hypesquad_online_house_2: { id: "hypesquad_house_2", description: "HypeSquad Brilliance", icon: "011940fd013da3f7fb926e4a1cd2e618", link: "https://discord.com/settings/hypesquad-online" },
    hypesquad_online_house_3: { id: "hypesquad_house_3", description: "HypeSquad Balance", icon: "3aa41de486fa12454c3761e8e223442e", link: "https://discord.com/settings/hypesquad-online" },
    partner: { id: "partner", description: "Partnered Server Owner", icon: "3f9748e53446a137a052f3454e2de41e", link: "https://discord.com/partners" },
    premium: { id: "premium", description: "Subscriber", icon: "2ba85e8026a8614b640c2837bcdfe21b", link: "https://discord.com/settings/premium" },
    premium_early_supporter: { id: "early_supporter", description: "Early Supporter", icon: "7060786766c9c840eb3019e725d2b358", link: "https://discord.com/settings/premium" },
    verified_developer: { id: "verified_developer", description: "Early Verified Bot Developer", icon: "6df5892e0f35b051f8b61eace34f4967" }
};

var premiumSinceKeys = ["premiumSince", "premium_since"];
var premiumGuildSinceKeys = ["premiumGuildSince", "premium_guild_since"];
var effectExpiresKeys = ["profileEffectExpiresAt", "profile_effect_expires_at"];

var premiumBoolKeys = new Set([
    "isPremium", "isPremiumExact", "hasPremium", "hasNitro",
    "canUsePremiumProfileCustomization", "canUsePremiumCustomization",
    "canUsePremiumProfile", "canUseAnimatedAvatar", "canUseAnimatedBanner", "canUseProfileThemes"
]);

var premiumFlagAliases = new Map([
    ["purchasedFlags", ["purchasedFlags", "purchased_flags"]],
    ["purchased_flags", ["purchasedFlags", "purchased_flags"]],
    ["premiumUsageFlags", ["premiumUsageFlags", "premium_usage_flags"]],
    ["premium_usage_flags", ["premiumUsageFlags", "premium_usage_flags"]]
]);

var accountFieldKeys = new Set([
    "bot", "system", "flags", "publicFlags", "public_flags",
    "email", "phone", "mfaEnabled", "mfa_enabled", "verified",
    "nsfwAllowed", "nsfw_allowed"
]);

var mirroredMetadataKeys = new Set([
    "username", "globalName", "global_name", "displayName", "display_name",
    "discriminator", "avatar", "avatarDecoration", "avatar_decoration",
    "avatarDecorationData", "avatar_decoration_data",
    "banner", "bannerHash", "banner_hash", "bannerUrl", "bannerURL", "banner_url",
    "accentColor", "accent_color",
    "premiumSince", "premium_since", "premiumGuildSince", "premium_guild_since",
    "premiumType", "premium_type",
    "publicFlags", "public_flags", "flags",
    "purchasedFlags", "purchased_flags", "premiumUsageFlags", "premium_usage_flags",
    "primaryGuild", "primary_guild", "collectibles",
    "displayNameStyles", "display_name_styles",
    "bot", "system"
]);

var rawProfileSkipKeys = new Set([
    "application", "applicationRoleConnections", "application_role_connections",
    "collectibles", "connectedAccounts", "connected_accounts", "widgets"
]);

var rawUserSkipKeys = new Set([
    "email", "phone", "mfaEnabled", "mfa_enabled", "verified",
    "nsfwAllowed", "nsfw_allowed", "personalConnectionId", "personal_connection_id"
]);

var dateKeys = new Set([
    "premiumSince", "premium_since", "premiumGuildSince", "premium_guild_since",
    "profileEffectExpiresAt", "profile_effect_expires_at"
]);

// ═══════════════════════════════════════════════════════════════════════════
//  Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function genId() {
    return "wow_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function extractUserId(v) {
    if (typeof v !== "string") return null;
    var m = v.match(/\d{17,20}/);
    return m ? m[0] : null;
}

function cloneLoose(v, seen) {
    if (v == null) return null;
    if (typeof v !== "object") return v;
    if (v instanceof Date) {
        try { return new Date(v.getTime()); } catch (_) { return null; }
    }
    if (Array.isArray(v)) {
        return v.map(function (item) { return cloneLoose(item, seen); });
    }
    seen = seen || new WeakMap();
    if (seen.has(v)) return seen.get(v);
    var next = Object.assign(Object.create(Object.getPrototypeOf(v) || Object.prototype), v);
    seen.set(v, next);
    var keys = Object.keys(next);
    for (var i = 0; i < keys.length; i++) {
        next[keys[i]] = cloneLoose(next[keys[i]], seen);
    }
    return next;
}

function cloneDiscordRecord(rec) {
    return Object.assign(Object.create(Object.getPrototypeOf(rec) || Object.prototype), rec);
}

function deepCloneRecord(rec, seen) {
    if (!rec || typeof rec !== "object") return rec;
    seen = seen || new WeakMap();
    var cached = seen.get(rec);
    if (cached) return cached;
    var next = cloneDiscordRecord(rec);
    seen.set(rec, next);
    var keys = Object.keys(next);
    for (var i = 0; i < keys.length; i++) {
        next[keys[i]] = cloneLoose(next[keys[i]], seen);
    }
    return next;
}

function cloneSnapshotValue(v, depth) {
    if (depth > 8) return null;
    if (v == null) return v;
    var t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (Array.isArray(v)) {
        return v.map(function (item) { return cloneSnapshotValue(item, (depth || 0) + 1); }).filter(function (x) { return x !== undefined; });
    }
    if (v instanceof Date) {
        try { return v.toISOString(); } catch (_) { return null; }
    }
    if (t !== "object") return undefined;
    var entries = Object.entries(v).flatMap(function (e) {
        var nv = cloneSnapshotValue(e[1], (depth || 0) + 1);
        return nv === undefined ? [] : [[e[0], nv]];
    });
    return Object.fromEntries(entries);
}

function cloneSnapshotBadges(badges) {
    if (!Array.isArray(badges)) return [];
    var seen = new Set();
    return badges.map(function (b) { return cloneSnapshotValue(b); }).filter(function (b) {
        if (!b || typeof b !== "object") return false;
        var k = getBadgeIdentityKey(b);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function cloneBadges(badges) {
    if (!Array.isArray(badges)) return [];
    var seen = new Set();
    return badges.map(function (b) { return cloneLoose(b); }).filter(function (b) {
        if (!b || typeof b !== "object") return false;
        var k = getBadgeIdentityKey(b);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function getBadgeIdentityKey(badge) {
    var comp = badge.component;
    var compKey = typeof comp === "function" ? (comp.displayName || comp.name || "component") : "";
    return [badge.id || "", badge.key || "", badge.icon || "", badge.iconSrc || "", badge.description || "", badge.link || "", compKey].join("|");
}

// ─── Record Access Helpers ───────────────────────────────────────────────
var profileRecordKeys = ["_userProfile", "_guildMemberProfile", "user_profile", "userProfile", "guild_member_profile", "guildMemberProfile"];

function recordCandidates() {
    var records = Array.prototype.slice.call(arguments);
    var candidates = [];
    for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!rec || typeof rec !== "object") continue;
        candidates.push(rec);
        for (var j = 0; j < profileRecordKeys.length; j++) {
            var nested = rec[profileRecordKeys[j]];
            if (nested && typeof nested === "object") candidates.push(nested);
        }
    }
    return candidates;
}

function recordValue(rec, keys) {
    var candidates = recordCandidates(rec);
    for (var i = 0; i < candidates.length; i++) {
        for (var j = 0; j < keys.length; j++) {
            if (keys[j] in candidates[i]) return candidates[i][keys[j]];
        }
    }
    return undefined;
}

function recordString(rec, keys) {
    var v = recordValue(rec, keys);
    return typeof v === "string" && v.length > 0 ? v : undefined;
}

function recordNumber(rec, keys) {
    var v = recordValue(rec, keys);
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function recordArray(rec, keys) {
    var v = recordValue(rec, keys);
    return Array.isArray(v) ? v : undefined;
}

function recordObject(rec, keys) {
    var v = recordValue(rec, keys);
    return v && typeof v === "object" ? v : undefined;
}

// ─── URL / CDN Helpers ──────────────────────────────────────────────────
function isRawAssetUrl(v) {
    return typeof v === "string" && /^https?:\/\//i.test(v);
}

function normalizeRawAssetUrl(url) {
    if (!url) return null;
    try {
        var parsed = new URL(url);
        if (parsed.hostname === "media.discordapp.net") {
            parsed.hostname = "cdn.discordapp.com";
            parsed.searchParams.delete("width");
            parsed.searchParams.delete("height");
            parsed.searchParams.delete("quality");
            parsed.searchParams.delete("format");
        }
        if ((parsed.hostname === "cdn.discordapp.com" || parsed.hostname === "cdn.discord.com") && !parsed.searchParams.has("size")) {
            parsed.searchParams.set("size", "1024");
        }
        return parsed.toString();
    } catch (_) {
        return url;
    }
}

function buildDiscordBannerUrl(userId, hash) {
    if (!userId || !hash || isRawAssetUrl(hash)) return null;
    var ext = hash.startsWith("a_") ? "gif" : "png";
    return CDN + "/banners/" + userId + "/" + hash + "." + ext + "?size=1024";
}

function buildDiscordAvatarUrl(userId, hash) {
    if (!userId || !hash) return null;
    var ext = hash.startsWith("a_") ? ".gif" : ".png";
    return CDN + "/avatars/" + userId + "/" + hash + ext + "?size=1024";
}

function readBannerFields(sourceUser, sourceProfile, snapshot, sourceRecord) {
    var rawUser = sourceUser;
    var rawProfile = sourceProfile;
    var sourceUserId = sourceUser ? sourceUser.id : (snapshot ? snapshot.sourceUserId : recordString(sourceRecord, ["userId", "user_id", "id"]) || null);
    var explicitBannerUrl =
        recordString(rawProfile, ["bannerUrl", "bannerURL", "banner_url"])
        || recordString(sourceRecord, ["bannerUrl", "bannerURL", "banner_url"])
        || recordString(rawUser, ["bannerUrl", "bannerURL", "banner_url"])
        || (snapshot ? snapshot.bannerUrl : null)
        || null;
    var bannerValue =
        recordString(rawProfile, ["banner", "bannerHash", "banner_hash"])
        || recordString(sourceRecord, ["banner", "bannerHash", "banner_hash"])
        || recordString(rawUser, ["banner", "bannerHash", "banner_hash"])
        || (snapshot ? snapshot.bannerHash : null)
        || (snapshot ? snapshot.banner : null)
        || null;
    var bannerHash = bannerValue && !isRawAssetUrl(bannerValue) ? bannerValue : null;
    var bannerUrl = normalizeRawAssetUrl(explicitBannerUrl || (isRawAssetUrl(bannerValue) ? bannerValue : buildDiscordBannerUrl(sourceUserId, bannerHash)));

    return {
        banner: bannerHash || bannerUrl,
        bannerHash: bannerHash,
        bannerUrl: bannerUrl
    };
}

// ─── Date Helpers ────────────────────────────────────────────────────────
function parseProfileDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) {
        return Number.isFinite(v.getTime()) ? new Date(v.getTime()) : null;
    }
    if (typeof v !== "string" && typeof v !== "number") return null;
    var d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

function isValidProfileDate(d) {
    return d && Number.isFinite(d.getTime());
}

function serializeProfileDate(d) {
    return isValidProfileDate(d) ? d.toISOString() : null;
}

function cloneProfileDate(d) {
    return isValidProfileDate(d) ? new Date(d.getTime()) : null;
}

function readProfileDate(keys, badges, badgeKind) {
    var sources = Array.prototype.slice.call(arguments, 3);
    for (var i = 0; i < keys.length; i++) {
        for (var s = 0; s < sources.length; s++) {
            var v = recordValue(sources[s], [keys[i]]);
            if (v != null) {
                var d = parseProfileDate(v);
                if (d) return d;
            }
        }
    }
    if (badgeKind) return readBadgeProfileDate(badges, badgeKind);
    return null;
}

function readBadgeProfileDate(badges, kind) {
    var matcher = kind === "premium"
        ? /subscriber since\s+(.+)$/i
        : /server boost(?:ing)? since\s+(.+)$/i;
    if (!Array.isArray(badges)) return null;
    for (var i = 0; i < badges.length; i++) {
        var desc = badges[i] && badges[i].description;
        if (typeof desc !== "string") continue;
        var match = desc.match(matcher);
        if (!match || !match[1]) continue;
        var d = parseBadgeDateText(match[1]);
        if (d) return d;
    }
    return null;
}

function parseBadgeDateText(text) {
    var t = text.trim();
    var slashDate = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashDate) {
        var first = Number(slashDate[1]);
        var second = Number(slashDate[2]);
        var rawYear = Number(slashDate[3]);
        var year = rawYear < 100 ? 2000 + rawYear : rawYear;
        var month = first > 12 ? second : first;
        var day = first > 12 ? first : second;
        var d = new Date(Date.UTC(year, month - 1, day, 12));
        if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return d;
        return null;
    }
    return parseProfileDate(t);
}

function badgeNeedsPremiumSince(badge) {
    var id = String(badge && badge.id || "").toLowerCase();
    var desc = String(badge && badge.description || "");
    return id === "premium" || id.startsWith("premium_tenure") || /subscriber since/i.test(desc);
}

function badgeProvesPremiumSubscription(badge) {
    var id = String(badge && badge.id || "").toLowerCase();
    var desc = String(badge && badge.description || "");
    return id.startsWith("premium_tenure") || /subscriber since/i.test(desc);
}

function badgeNeedsPremiumGuildSince(badge) {
    var id = String(badge && badge.id || "").toLowerCase();
    var desc = String(badge && badge.description || "");
    return id.startsWith("guild_booster") || /server boost(?:ing)? since/i.test(desc);
}

function hasPremiumSubscriptionBadge(badges) {
    if (!Array.isArray(badges)) return false;
    return badges.some(badgeProvesPremiumSubscription);
}

// ─── Premium Helpers ─────────────────────────────────────────────────────
function readPremiumTypeFromRecords() {
    var sources = arguments;
    for (var i = 0; i < sources.length; i++) {
        var v = recordNumber(sources[i], ["premiumType", "premium_type"]);
        if (typeof v === "number") return v;
    }
    return undefined;
}

function inferMirroredPremiumType(explicitPremiumType, opts) {
    if (typeof explicitPremiumType === "number" && explicitPremiumType > 0) return explicitPremiumType;
    if (opts && opts.badges && hasPremiumSubscriptionBadge(opts.badges)) return 2;
    if (opts && opts.premiumSince && isValidProfileDate(opts.premiumSince)) return 2;
    return undefined;
}

function hasMirroredPremiumProfile(mp) {
    return Boolean(mp && inferMirroredPremiumType(mp.premiumType, mp));
}

function filterBadgesForAvailableDates(badges, premiumSince, premiumGuildSince) {
    if (!Array.isArray(badges)) return [];
    var hasPS = isValidProfileDate(premiumSince);
    var hasPGS = isValidProfileDate(premiumGuildSince);
    return cloneBadges(badges).filter(function (badge) {
        if (!hasPS && badgeNeedsPremiumSince(badge)) return false;
        if (!hasPGS && badgeNeedsPremiumGuildSince(badge)) return false;
        return true;
    });
}

function deriveFallbackBadges(sourceUser, sourceProfile) {
    if (!sourceUser) return [];
    var badges = [];
    var flagMap = userFlags || {};
    for (var key in flagMap) {
        var flag = flagMap[key];
        if (typeof flag === "number" && typeof sourceUser.hasFlag === "function" && sourceUser.hasFlag(flag)) {
            var fb = FALLBACK_BADGES[key.toLowerCase()];
            if (fb) badges.push(cloneLoose(fb));
        }
    }
    var pt = readPremiumTypeFromRecords(sourceProfile, sourceUser);
    var ps = readProfileDate(premiumSinceKeys, badges, "premium", sourceProfile, sourceUser);
    var inferred = inferMirroredPremiumType(pt, { badges: badges, premiumSince: ps });
    if (inferred && inferred > 0) {
        var hasP = badges.some(function (b) { return badgeNeedsPremiumSince(b); });
        if (!hasP) badges.push(cloneLoose(FALLBACK_BADGES.premium));
    }
    return badges;
}

// ─── Profile Data Building ───────────────────────────────────────────────
function buildMirroredProfileData(sourceUser, sourceProfile, snapshot, sourceRecord) {
    var rawProfile = sourceProfile && typeof sourceProfile === "object" ? sourceProfile : null;
    var rawUser = sourceUser;
    var bf = readBannerFields(sourceUser, rawProfile, snapshot, sourceRecord);
    var sourceRawUser = rawUser ? cloneLoose(rawUser) : (snapshot && snapshot.rawUser ? cloneLoose(snapshot.rawUser) : null);
    var sourceRawProfile = rawProfile ? cloneLoose(rawProfile) : (sourceRecord ? cloneLoose(sourceRecord) : (snapshot && snapshot.rawProfile ? cloneLoose(snapshot.rawProfile) : null));
    var sourceBadges = Array.isArray(rawProfile && rawProfile.badges) && rawProfile.badges.length > 0
        ? cloneBadges(rawProfile.badges)
        : Array.isArray(recordArray(sourceRecord, ["badges"])) && recordArray(sourceRecord, ["badges"]).length > 0
            ? cloneBadges(recordArray(sourceRecord, ["badges"]))
            : snapshot && snapshot.badges && snapshot.badges.length
                ? cloneBadges(snapshot.badges)
                : sourceUser
                    ? deriveFallbackBadges(sourceUser, sourceProfile)
                    : [];
    var premiumSince = readProfileDate(premiumSinceKeys, sourceBadges, "premium", rawProfile, sourceRecord, snapshot, snapshot && snapshot.rawProfile);
    var premiumGuildSince = readProfileDate(premiumGuildSinceKeys, sourceBadges, "guild_booster", rawProfile, sourceRecord, snapshot, snapshot && snapshot.rawProfile);
    var profileEffectExpiresAt = readProfileDate(effectExpiresKeys, sourceBadges, null, rawProfile, sourceRecord, snapshot, snapshot && snapshot.rawProfile);
    var badges = filterBadgesForAvailableDates(sourceBadges, premiumSince, premiumGuildSince);
    var themeColors = cloneLoose(rawProfile && rawProfile.themeColors || recordArray(sourceRecord, ["themeColors", "theme_colors"]) || (snapshot ? snapshot.themeColors : null));
    var accentColor = rawProfile && rawProfile.accentColor != null ? rawProfile.accentColor
        : recordNumber(sourceRecord, ["accentColor", "accent_color"]) != null ? recordNumber(sourceRecord, ["accentColor", "accent_color"])
        : sourceUser && sourceUser.accentColor != null ? sourceUser.accentColor
        : snapshot && snapshot.accentColor != null ? snapshot.accentColor
        : null;
    var avatarDecoration = cloneLoose(rawProfile && rawProfile.avatarDecoration || recordObject(sourceRecord, ["avatarDecoration", "avatar_decoration"]) || (sourceUser ? sourceUser.avatarDecoration : null) || (snapshot ? snapshot.avatarDecoration : null));
    var avatarDecorationData = cloneLoose(rawProfile && rawProfile.avatarDecorationData || recordObject(sourceRecord, ["avatarDecorationData", "avatar_decoration_data"]) || (sourceUser ? sourceUser.avatarDecorationData : null) || (snapshot ? snapshot.avatarDecorationData : null));
    var profileEffect = cloneLoose(rawProfile && rawProfile.profileEffect || recordObject(sourceRecord, ["profileEffect", "profile_effect"]) || (sourceUser ? sourceUser.profileEffect : null) || (snapshot ? snapshot.profileEffect : null));
    var profileEffectId = (rawProfile && rawProfile.profileEffectId) || recordString(sourceRecord, ["profileEffectId", "profile_effect_id"]) || (sourceUser ? sourceUser.profileEffectId : null) || (snapshot ? snapshot.profileEffectId : null) || null;
    var premiumType = inferMirroredPremiumType(
        readPremiumTypeFromRecords(rawProfile, sourceRecord, rawUser, snapshot && snapshot.rawProfile, snapshot && snapshot.rawUser),
        { badges: badges, premiumSince: premiumSince }
    );
    var bio = typeof (rawProfile && rawProfile.bio) === "string" ? rawProfile.bio
        : recordString(sourceRecord, ["bio"]) || (snapshot ? snapshot.bio : "") || "";
    var pronouns = typeof (rawProfile && rawProfile.pronouns) === "string" ? rawProfile.pronouns
        : recordString(sourceRecord, ["pronouns"]) || (snapshot ? snapshot.pronouns : "") || "";

    return {
        sourceUserId: sourceUser ? sourceUser.id : (snapshot ? snapshot.sourceUserId : recordString(sourceRecord, ["userId", "user_id", "id"])) || null,
        accentColor: accentColor,
        avatarDecoration: avatarDecoration,
        avatarDecorationData: avatarDecorationData,
        badges: badges,
        banner: bf.banner,
        bannerHash: bf.bannerHash,
        bannerUrl: bf.bannerUrl,
        bio: bio,
        premiumSince: premiumSince,
        premiumGuildSince: premiumGuildSince,
        premiumType: premiumType,
        profileEffect: profileEffect,
        profileEffectExpiresAt: profileEffectExpiresAt,
        profileEffectId: profileEffectId,
        pronouns: pronouns,
        rawProfile: sourceRawProfile,
        rawUser: sourceRawUser,
        themeColors: themeColors
    };
}

function applyMirroredProfileBase(profile, mp, userId, sourceRecord, opts) {
    opts = opts || {};
    var next = cloneLoose(profile) || {};
    if (mp.rawProfile) {
        for (var k in mp.rawProfile) {
            if (k !== "userId" && k !== "_userProfile" && k !== "_guildMemberProfile") {
                if (next[k] == null) next[k] = cloneLoose(mp.rawProfile[k]);
            }
        }
    }
    var hasPrem = hasMirroredPremiumProfile(mp);

    next.userId = userId;
    next.user_id = userId;
    next.accentColor = mp.accentColor;
    next.accent_color = mp.accentColor;
    next.avatarDecoration = cloneLoose(mp.avatarDecoration);
    next.avatar_decoration = cloneLoose(mp.avatarDecoration);
    next.avatarDecorationData = cloneLoose(mp.avatarDecorationData);
    next.avatar_decoration_data = cloneLoose(mp.avatarDecorationData);

    if ("badges" in next) {
        if (opts.badges === "clear") {
            next.badges = [];
        } else if (opts.badges !== "preserve") {
            next.badges = cloneBadges(mp.badges);
        }
    }

    next.themeColors = cloneLoose(mp.themeColors);
    next.theme_colors = cloneLoose(mp.themeColors);
    next.banner = mp.banner;
    next.bannerHash = mp.bannerHash;
    next.banner_hash = mp.bannerHash;
    next.bannerUrl = mp.bannerUrl;
    next.bannerURL = mp.bannerUrl;
    next.banner_url = mp.bannerUrl;
    next.bio = mp.bio;
    next.premiumSince = cloneProfileDate(mp.premiumSince);
    next.premium_since = cloneProfileDate(mp.premiumSince);
    next.premiumGuildSince = cloneProfileDate(mp.premiumGuildSince);
    next.premium_guild_since = cloneProfileDate(mp.premiumGuildSince);
    next.premiumType = mp.premiumType || 0;
    next.premium_type = mp.premiumType || 0;

    premiumFlagAliases.forEach(function (aliases, key) {
        next[key] = cloneLoose(recordValue(sourceRecord, aliases) || recordValue(mp.rawProfile, aliases) || recordValue(mp.rawUser, aliases) || 0);
    });

    next.profileEffect = cloneLoose(mp.profileEffect);
    next.profile_effect = cloneLoose(mp.profileEffect);
    next.profileEffectExpiresAt = cloneProfileDate(mp.profileEffectExpiresAt);
    next.profile_effect_expires_at = cloneProfileDate(mp.profileEffectExpiresAt);
    next.profileEffectId = mp.profileEffectId;
    next.profile_effect_id = mp.profileEffectId;
    next.pronouns = mp.pronouns || "";

    premiumBoolKeys.forEach(function (key) {
        if (hasPrem || key in next) next[key] = hasPrem;
    });

    if ("primaryColor" in next || !mp.banner) {
        next.primaryColor = next.themeColors && next.themeColors[0] != null ? next.themeColors[0] : next.accentColor != null ? next.accentColor : undefined;
    }

    if ("canUsePremiumProfileCustomization" in next) {
        next.canUsePremiumProfileCustomization = hasPrem;
    }

    // Wrap getBadges to filter duplicates at access time
    if (typeof next.getBadges === "function") {
        var origGetBadges = next.getBadges;
        Object.defineProperty(next, "getBadges", {
            configurable: true, enumerable: false, writable: true,
            value: function () {
                var b = origGetBadges.apply(this, arguments);
                if (!Array.isArray(b)) return b;
                return filterBadgesForAvailableDates(b,
                    parseProfileDate(this.premiumSince || this.premium_since),
                    parseProfileDate(this.premiumGuildSince || this.premium_guild_since));
            }
        });
    }

    return next;
}

function applyMirroredProfileData(profile, mp, userId, sourceRecord, opts) {
    opts = opts || {};
    var np = applyMirroredProfileBase(profile, mp, userId, sourceRecord, { badges: opts.topLevelBadges || "mirror" });
    var shouldNested = Boolean(
        mp.pronouns || mp.bio || mp.badges && mp.badges.length || mp.banner || mp.bannerHash || mp.bannerUrl
        || mp.accentColor != null || mp.themeColors && mp.themeColors.length || mp.premiumSince || mp.premiumGuildSince
        || mp.premiumType != null || mp.profileEffect || mp.profileEffectExpiresAt || mp.profileEffectId
        || mp.avatarDecoration || mp.avatarDecorationData
    );

    if (np._userProfile || (sourceRecord && sourceRecord._userProfile) || shouldNested) {
        np._userProfile = applyMirroredProfileBase(np._userProfile || (sourceRecord && sourceRecord._userProfile) || {}, mp, userId, sourceRecord && sourceRecord._userProfile, { badges: opts.userProfileBadges || "mirror" });
    }
    if (np._guildMemberProfile || (sourceRecord && sourceRecord._guildMemberProfile) || shouldNested) {
        np._guildMemberProfile = applyMirroredProfileBase(np._guildMemberProfile || (sourceRecord && sourceRecord._guildMemberProfile) || {}, mp, userId, sourceRecord && sourceRecord._guildMemberProfile, { badges: opts.guildMemberProfileBadges || "clear" });
    }

    return np;
}

function applyMirroredSourceRecordData(profile, sourceRecord, mp, userId, opts) {
    return applyMirroredProfileData(
        mergeLooseRecord(profile, sourceRecord, ["id", "userId", "_userProfile", "_guildMemberProfile"]),
        mp, userId, sourceRecord, opts
    );
}

function mergeLooseRecord(target, source, excludedKeys) {
    if (!source) return target;
    var next = cloneDiscordRecord(target);
    var excluded = new Set(excludedKeys || []);
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
        if (excluded.has(keys[i])) continue;
        next[keys[i]] = cloneLoose(source[keys[i]]);
    }
    return next;
}

function buildAliasedProfile(targetUserId, mp, sourceRecord) {
    var targetProfile = getRawUserProfile(targetUserId) || cachedProfilesByUserId.get(targetUserId) || null;
    if (!targetProfile) {
        return applyMirroredProfileData(cloneLoose(sourceRecord || {}), mp, targetUserId, sourceRecord);
    }
    return applyMirroredSourceRecordData(targetProfile, sourceRecord, mp, targetUserId);
}

// ─── ID Rewriting ────────────────────────────────────────────────────────
function rewriteIds(obj, from, to, depth) {
    if (!obj || typeof obj !== "object" || depth > 14) return;
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
            if (obj[i] && typeof obj[i] === "object") rewriteIds(obj[i], from, to, depth + 1);
        }
        return;
    }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var val = obj[key];
        if ((key === "userId" || key === "user_id") && val === from) { obj[key] = to; continue; }
        if (key === "id" && val === from) {
            if (typeof obj.username === "string" || typeof obj.globalName === "string" || typeof obj.avatar !== "undefined" || typeof obj.discriminator === "string") {
                obj[key] = to; continue;
            }
        }
        if (val && typeof val === "object") rewriteIds(val, from, to, depth + 1);
    }
}

function alignProfileIdentityToRequester(profile, requestedUserId, internalUserId) {
    if (requestedUserId === internalUserId) return profile;
    var next = cloneDiscordRecord(profile);
    rewriteIds(next, internalUserId, requestedUserId, 0);
    return next;
}

function alignProfileIdentityToTarget(profile, sourceUserId, targetUserId) {
    if (!sourceUserId || sourceUserId === targetUserId) return profile;
    var next = cloneDiscordRecord(profile);
    rewriteIds(next, sourceUserId, targetUserId, 0);
    return next;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Store Accessors
// ═══════════════════════════════════════════════════════════════════════════

var _origGetUser = null;
var _origGetCurrentUser = null;
var _origGetUserProfile = null;
var _origGetMember = null;

function getRawUser(userId) {
    var getter = _origGetUser || (UserStore && UserStore.getUser ? UserStore.getUser.bind(UserStore) : null);
    if (!getter) return null;
    try { var u = getter(userId); return u || null; } catch (_) { return null; }
}

function getRawUserProfile(userId) {
    var getter = _origGetUserProfile || (UserProfileStore && UserProfileStore.getUserProfile ? UserProfileStore.getUserProfile.bind(UserProfileStore) : null);
    if (!getter) return null;
    try { var p = getter(userId); return p || null; } catch (_) { return null; }
}

function getCurrentUserId() {
    try { return UserStore && UserStore.getCurrentUser ? UserStore.getCurrentUser().id : null; } catch (_) { return null; }
}

function getNativeGuildMember(guildId, userId) {
    if (!guildId || !userId) return null;
    var key = guildId + ":" + userId;
    if (cachedGuildMembersByKey.has(key)) return cachedGuildMembersByKey.get(key);
    if (_origGetMember) {
        try { var m = _origGetMember(guildId, userId); if (m) return m; } catch (_) {}
    }
    return null;
}

// ─── Alias Resolution ────────────────────────────────────────────────────
function getProfileRedirectTargetUserId(userId) {
    if (!userId) return null;
    return preferredTargetUserIdsBySourceId.get(userId) || null;
}

function getDirectMirroredSourceUserId(userId) {
    if (!userId) return null;
    return mirrorTargetToSourceId.get(userId)
        || (sourceSnapshotsByTargetId.has(userId) ? sourceSnapshotsByTargetId.get(userId).sourceUserId : null)
        || null;
}

function getPresenceSourceUserId(userId) {
    if (!userId) return null;
    var resolved = getProfileRedirectTargetUserId(userId) || userId;
    return getDirectMirroredSourceUserId(resolved);
}

// ─── Guild Context ───────────────────────────────────────────────────────
function getCurrentGuildContextId() {
    try {
        var chId = SelectedChannelStore ? SelectedChannelStore.getChannelId() : null;
        return chId ? (ChannelStore && ChannelStore.getChannel(chId) ? ChannelStore.getChannel(chId).guild_id : null) : null;
    } catch (_) { return null; }
}

function rememberGuildContext(guildId) {
    if (!guildId) return;
    for (var i = 1; i < arguments.length; i++) {
        if (arguments[i] && typeof arguments[i] === "string") {
            lastKnownGuildContextByUserId.set(arguments[i], guildId);
        }
    }
}

function resolveGuildContext() {
    var currentGuildId = getCurrentGuildContextId();
    if (!currentGuildId) return null;
    for (var i = 0; i < arguments.length; i++) {
        if (!arguments[i]) continue;
        var g = lastKnownGuildContextByUserId.get(arguments[i]);
        if (g === currentGuildId) return g;
    }
    return currentGuildId;
}

// ─── Guild Member Building ──────────────────────────────────────────────
function getGuildMemberCacheKey(guildId, userId) { return guildId + ":" + userId; }

function dedupeRoleIds(roles) {
    if (!Array.isArray(roles)) return [];
    var seen = new Set();
    var next = [];
    for (var i = 0; i < roles.length; i++) {
        if (typeof roles[i] !== "string" || seen.has(roles[i])) continue;
        seen.add(roles[i]);
        next.push(roles[i]);
    }
    return next;
}

function normalizeGuildMember(guildId, userId, member) {
    if (!member || typeof member !== "object") return null;
    var next = cloneDiscordRecord(member);
    next.guildId = guildId;
    next.userId = userId;
    next.roles = dedupeRoleIds(next.roles);
    return next;
}

function buildMirroredGuildMember(guildId, userId) {
    if (!guildId || !userId) return null;
    var requestedUserId = userId;
    var resolvedTargetUserId = getProfileRedirectTargetUserId(requestedUserId) || requestedUserId;
    var sourceUserId = resolvedTargetUserId !== requestedUserId
        ? requestedUserId
        : getDirectMirroredSourceUserId(resolvedTargetUserId);
    rememberGuildContext(guildId, requestedUserId, resolvedTargetUserId, sourceUserId);

    var targetMember = getNativeGuildMember(guildId, resolvedTargetUserId);
    if (!sourceUserId) {
        if (!targetMember) return null;
        if (requestedUserId !== resolvedTargetUserId) {
            var gm = cloneDiscordRecord(targetMember);
            gm.userId = requestedUserId;
            gm.guildId = guildId;
            gm.roles = dedupeRoleIds(gm.roles);
            if (typeof gm.id === "string") gm.id = requestedUserId;
            return gm;
        }
        return targetMember;
    }

    var sourceMember = getNativeGuildMember(guildId, sourceUserId);
    if (!sourceMember) {
        if (!targetMember) return null;
        if (requestedUserId !== resolvedTargetUserId) {
            var gm2 = cloneDiscordRecord(targetMember);
            gm2.userId = requestedUserId;
            gm2.guildId = guildId;
            gm2.roles = dedupeRoleIds(gm2.roles);
            if (typeof gm2.id === "string") gm2.id = requestedUserId;
            return gm2;
        }
        return targetMember;
    }

    var nextMember = mergeLooseRecord(cloneDiscordRecord(targetMember || sourceMember), sourceMember, ["userId", "guildId", "id"]);
    nextMember.userId = requestedUserId;
    nextMember.guildId = guildId;
    nextMember.roles = dedupeRoleIds(nextMember.roles);
    if (typeof nextMember.id === "string") nextMember.id = requestedUserId;
    return nextMember;
}

// ─── Username Mirroring ─────────────────────────────────────────────────
function unwrapAliasedUserProxy(u) {
    if (!u || typeof u !== "object") return u;
    return aliasProxyToUnderlying.get(u) || u;
}

function readDiscordUsername(u) {
    if (!u) return "";
    var raw = unwrapAliasedUserProxy(u) || u;
    var v = raw.username;
    return typeof v === "string" ? v : "";
}

function readDiscordGlobalName(u) {
    if (!u) return null;
    var raw = unwrapAliasedUserProxy(u) || u;
    var v = raw.globalName;
    return typeof v === "string" && v.length > 0 ? v : null;
}

function getMirroredUsername(user) {
    var u = unwrapAliasedUserProxy(user) || user;
    if (!u || !u.id) return readDiscordUsername(u);
    var mappedSource = sourceUsersByTargetId.get(u.id);
    if (mappedSource) {
        var rawSource = unwrapAliasedUserProxy(mappedSource) || mappedSource;
        var fromSource = readDiscordUsername(rawSource);
        if (fromSource.length > 0) return fromSource;
    }
    var snap = sourceSnapshotsByTargetId.get(u.id);
    if (snap && typeof snap.username === "string" && snap.username.length > 0) return snap.username;
    return readDiscordUsername(u);
}

function getMirroredGlobalName(user) {
    var u = unwrapAliasedUserProxy(user) || user;
    if (!u || !u.id) return readDiscordGlobalName(u);
    var mappedSource = sourceUsersByTargetId.get(u.id);
    if (mappedSource) {
        var rawSource = unwrapAliasedUserProxy(mappedSource) || mappedSource;
        var fromSource = readDiscordGlobalName(rawSource);
        if (typeof fromSource === "string" && fromSource.length > 0) return fromSource;
    }
    var snap = sourceSnapshotsByTargetId.get(u.id);
    if (snap && typeof snap.globalName === "string" && snap.globalName.length > 0) return snap.globalName;
    if (sourceUsersByTargetId.has(u.id) || sourceSnapshotsByTargetId.has(u.id)) return null;
    return readDiscordGlobalName(u);
}

function mirroredName(user) {
    var gn = getMirroredGlobalName(user);
    if (typeof gn === "string" && gn.length > 0) return gn;
    return getMirroredUsername(user);
}

function getMirroredUserTag(user, fallback) {
    if (!user || !user.id) return fallback || "";
    var username = getMirroredUsername(user);
    if (typeof username === "string" && username.length > 0) return username;
    return fallback || "";
}

// ─── Proxy User View ─────────────────────────────────────────────────────
function readSnapshotUserMetadata(snapshot, prop) {
    if (!snapshot) return undefined;
    if (prop === "username") return snapshot.username;
    if (prop === "globalName" || prop === "global_name") return snapshot.globalName;
    if (prop === "displayName" || prop === "display_name") return snapshot.displayName;
    if (prop === "avatar") return snapshot.avatar;
    if (prop === "avatarDecoration" || prop === "avatar_decoration") return snapshot.avatarDecoration;
    if (prop === "avatarDecorationData" || prop === "avatar_decoration_data") return snapshot.avatarDecorationData;
    if (prop === "banner") return snapshot.banner;
    if (prop === "bannerHash" || prop === "banner_hash") return snapshot.bannerHash;
    if (prop === "bannerUrl" || prop === "bannerURL" || prop === "banner_url") return snapshot.bannerUrl;
    if (prop === "accentColor" || prop === "accent_color") return snapshot.accentColor;
    if (prop === "premiumSince" || prop === "premium_since") return snapshot.premiumSince;
    if (prop === "premiumGuildSince" || prop === "premium_guild_since") return snapshot.premiumGuildSince;
    if (prop === "premiumType" || prop === "premium_type") return snapshot.premiumType;
    if (snapshot.rawUser && prop in snapshot.rawUser) return cloneLoose(snapshot.rawUser[prop]);
    return undefined;
}

function readMirroredPremiumFlagValue(sourceUser, snapshot, prop) {
    var aliases = premiumFlagAliases.get(prop);
    if (!aliases) return undefined;
    var v = recordValue(sourceUser, aliases);
    if (v !== undefined) return cloneLoose(v);
    v = recordValue(snapshot && snapshot.rawUser, aliases);
    if (v !== undefined) return cloneLoose(v);
    return 0;
}

function isGuildTagLikeKey(key) {
    return /(?:primary.*guild|guild.*tag|guild.*identity|clan|display.*tag|identity.*tag)/i.test(key);
}

function emptyMirroredValue(value) {
    if (Array.isArray(value)) return [];
    if (typeof value === "boolean") return false;
    return null;
}

function pickGuildTagFields(source) {
    if (!source) return {};
    return Object.fromEntries(
        Object.entries(source).filter(function (e) { return isGuildTagLikeKey(e[0]); }).map(function (e) { return [e[0], cloneLoose(e[1])]; })
    );
}

function getAliasedUserView(user, opts) {
    opts = opts || {};
    if (!user) return user;
    // Prevent re-entrant Proxy wrapping (stops stack overflow)
    if (inGetAliasedUserView > 0) return user;
    // Unwrap any existing Proxy to get the raw underlying user object
    var rawUser = unwrapAliasedUserProxy(user) || user;
    if (!rawUser || !rawUser.id) return user;

    var targetId = rawUser.id;
    var sourceUser = sourceUsersByTargetId.get(targetId);
    var sourceProfile = sourceProfilesByTargetId.get(targetId) || null;
    var sourceSnapshot = sourceSnapshotsByTargetId.get(targetId);
    if (!sourceUser && !sourceSnapshot) return user;

    var cacheKeySource = sourceProfile || sourceUser || sourceSnapshot || null;
    var viewCache = opts.preserveAccountFields ? aliasedCurrentUserViews : aliasedUserViews;
    var cachedView = viewCache.get(targetId);
    if (cachedView && cachedView.target === rawUser && cachedView.source === cacheKeySource) {
        return cachedView.proxy;
    }

    inGetAliasedUserView++;
    try {
    var mp = buildMirroredProfileData(sourceUser, sourceProfile, sourceSnapshot, (sourceProfile) || (sourceSnapshot ? sourceSnapshot.rawProfile : null));
    var hasPrem = hasMirroredPremiumProfile(mp);

    var proxy = new Proxy(rawUser, {
        get: function (target, prop, receiver) {
            // Preserve account-critical fields for current user
            if (opts.preserveAccountFields && typeof prop === "string") {
                if (accountFieldKeys.has(prop)) {
                    return Reflect.get(target, prop, receiver);
                }
                var ownDesc = Object.getOwnPropertyDescriptor(target, prop);
                if (ownDesc && ownDesc.configurable === false && "value" in ownDesc) {
                    return ownDesc.value;
                }
            }

            if (prop === "username") return getMirroredUsername(user);
            if (prop === "globalName") return getMirroredGlobalName(user);
            if (prop === "displayName") return mirroredName(user);
            if (prop === "tag") return getMirroredUserTag(user, Reflect.get(target, prop, receiver));
            if (prop === "discriminator") {
                if (sourceUsersByTargetId.has(targetId) || sourceSnapshotsByTargetId.has(targetId)) return "0";
                return Reflect.get(target, prop, receiver);
            }
            if (prop === "avatar") return (sourceUser ? sourceUser.avatar : null) || (sourceSnapshot ? sourceSnapshot.avatar : null) || Reflect.get(target, prop, receiver);
            if (prop === "avatarDecoration") return (sourceUser ? sourceUser.avatarDecoration : null) || (sourceSnapshot ? sourceSnapshot.avatarDecoration : null) || Reflect.get(target, prop, receiver);
            if (prop === "avatarDecorationData") return (sourceUser ? sourceUser.avatarDecorationData : null) || (sourceSnapshot ? sourceSnapshot.avatarDecorationData : null) || Reflect.get(target, prop, receiver);
            if (prop === "premiumType" || prop === "premium_type") return mp.premiumType || 0;
            if (prop === "premiumSince" || prop === "premium_since") return serializeProfileDate(mp.premiumSince);
            if (prop === "premiumGuildSince" || prop === "premium_guild_since") return serializeProfileDate(mp.premiumGuildSince);
            if (prop === "accentColor" || prop === "accent_color") return mp.accentColor;

            if (typeof prop === "string" && premiumBoolKeys.has(prop)) {
                var curVal = Reflect.get(target, prop, receiver);
                return typeof curVal === "function" ? function () { return hasPrem; } : hasPrem;
            }

            if (typeof prop === "string" && premiumFlagAliases.has(prop)) {
                return readMirroredPremiumFlagValue(sourceUser, sourceSnapshot, prop);
            }

            if (typeof prop === "string" && mirroredMetadataKeys.has(prop)) {
                if (sourceUser && prop in sourceUser) return cloneLoose(sourceUser[prop]);
                var snapVal = readSnapshotUserMetadata(sourceSnapshot, prop);
                if (snapVal !== undefined) return cloneLoose(snapVal);
            }

            if (typeof prop === "string" && isGuildTagLikeKey(prop)) {
                if (sourceUser && prop in sourceUser) return cloneLoose(sourceUser[prop]);
                if (sourceSnapshot && sourceSnapshot.tagFields && prop in sourceSnapshot.tagFields) return cloneLoose(sourceSnapshot.tagFields[prop]);
                var cv = Reflect.get(target, prop, receiver);
                return cv == null ? cv : emptyMirroredValue(cv);
            }

            if (prop === "getAvatarURL") {
                return function () {
                    var su = sourceUsersByTargetId.get(targetId);
                    var ss = sourceSnapshotsByTargetId.get(targetId);
                    if (su) return getAvatarUrlForUser(su);
                    if (ss && ss.avatarUrl) return ss.avatarUrl;
                    return target.getAvatarURL ? target.getAvatarURL.apply(target, arguments) : "";
                };
            }

            if (prop === "getAvatarSource") {
                return function () {
                    var su = sourceUsersByTargetId.get(targetId);
                    if (su && typeof su.getAvatarSource === "function") return su.getAvatarSource.apply(su, arguments);
                    return target.getAvatarSource ? target.getAvatarSource.apply(target, arguments) : "";
                };
            }

            return Reflect.get(target, prop, receiver);
        },
        ownKeys: function (target) {
            return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor: function (target, prop) {
            return Object.getOwnPropertyDescriptor(target, prop);
        },
        has: function (target, prop) {
            return prop in target;
        }
    });

    aliasProxyToUnderlying.set(proxy, rawUser);
    viewCache.set(targetId, { target: rawUser, source: cacheKeySource, proxy: proxy });
    return proxy;
    } finally { inGetAliasedUserView--; }
}

// ─── Snapshot Helpers ────────────────────────────────────────────────────
function getAvatarUrlForUser(user) {
    try { if (typeof user.getAvatarURL === "function") return user.getAvatarURL(undefined, 128, false); } catch (_) {}
    try {
        return IconUtils && IconUtils.getUserAvatarURL
            ? IconUtils.getUserAvatarURL(user, undefined, 128, undefined)
            : "";
    } catch (_) { return ""; }
}

function createUserAliasSnapshot(sourceUser, sourceProfile, previousSnapshot) {
    var mp = buildMirroredProfileData(sourceUser, sourceProfile, previousSnapshot, previousSnapshot ? previousSnapshot.rawProfile : null);
    var rawProfileSnap = repairRawDates(
        cloneRawProfile(mp.rawProfile), mp.badges, mp.premiumSince, mp.premiumGuildSince, mp.profileEffectExpiresAt
    );
    return {
        sourceUserId: sourceUser.id,
        username: sourceUser.username,
        globalName: sourceUser.globalName || null,
        displayName: sourceUser.displayName || sourceUser.globalName || sourceUser.username,
        avatar: sourceUser.avatar || null,
        avatarUrl: getAvatarUrlForUser(sourceUser),
        accentColor: mp.accentColor,
        avatarDecoration: cloneSnapshotValue(mp.avatarDecoration),
        avatarDecorationData: cloneSnapshotValue(mp.avatarDecorationData),
        badges: cloneSnapshotBadges(mp.badges),
        banner: mp.banner,
        bannerHash: mp.bannerHash,
        bannerUrl: mp.bannerUrl,
        bio: mp.bio,
        premiumSince: serializeProfileDate(mp.premiumSince),
        premiumGuildSince: serializeProfileDate(mp.premiumGuildSince),
        premiumType: mp.premiumType,
        profileEffect: cloneSnapshotValue(mp.profileEffect),
        profileEffectExpiresAt: serializeProfileDate(mp.profileEffectExpiresAt),
        profileEffectId: mp.profileEffectId,
        pronouns: mp.pronouns,
        rawProfile: rawProfileSnap,
        rawUser: cloneSnapshotRawUser(mp.rawUser),
        tagFields: cloneSnapshotValue(pickGuildTagFields(sourceUser)) || {},
        themeColors: cloneLoose(mp.themeColors)
    };
}

function cloneRawProfile(rawProfile) {
    if (!rawProfile || typeof rawProfile !== "object") return null;
    return Object.fromEntries(
        Object.entries(rawProfile)
            .filter(function (e) { return !rawProfileSkipKeys.has(e[0]); })
            .flatMap(function (e) {
                if (dateKeys.has(e[0])) {
                    var d = parseProfileDate(e[1]);
                    return [[e[0], serializeProfileDate(d)]];
                }
                var nv = cloneSnapshotValue(e[1]);
                return nv === undefined ? [] : [[e[0], nv]];
            })
    );
}

function cloneSnapshotRawUser(user) {
    if (!user || typeof user !== "object") return null;
    return Object.fromEntries(
        Object.entries(user)
            .filter(function (e) { return !rawUserSkipKeys.has(e[0]); })
            .flatMap(function (e) {
                var nv = cloneSnapshotValue(e[1]);
                return nv === undefined ? [] : [[e[0], nv]];
            })
    );
}

function repairRawDates(rawProfile, badges, premiumSince, premiumGuildSince, profileEffectExpiresAt) {
    if (!rawProfile) return rawProfile;
    if (premiumSinceKeys.some(function (k) { return k in rawProfile; }) || premiumSince) {
        rawProfile.premiumSince = serializeProfileDate(premiumSince);
        rawProfile.premium_since = serializeProfileDate(premiumSince);
    }
    if (premiumGuildSinceKeys.some(function (k) { return k in rawProfile; }) || premiumGuildSince) {
        rawProfile.premiumGuildSince = serializeProfileDate(premiumGuildSince);
        rawProfile.premium_guild_since = serializeProfileDate(premiumGuildSince);
    }
    if (effectExpiresKeys.some(function (k) { return k in rawProfile; }) || profileEffectExpiresAt) {
        rawProfile.profileEffectExpiresAt = serializeProfileDate(profileEffectExpiresAt);
        rawProfile.profile_effect_expires_at = serializeProfileDate(profileEffectExpiresAt);
    }
    if (Array.isArray(rawProfile.badges)) {
        rawProfile.badges = filterBadgesForAvailableDates(badges, premiumSince, premiumGuildSince);
    }
    return rawProfile;
}

function snapshotHasLoadedProfile(snap) {
    return Boolean(snap && (
        snap.rawProfile || snap.pronouns || snap.bio || snap.banner || snap.bannerHash
        || snap.bannerUrl || snap.profileEffect || snap.profileEffectId || snap.avatarDecoration
        || snap.avatarDecorationData || snap.accentColor != null || (snap.themeColors && snap.themeColors.length)
        || (snap.badges && snap.badges.length)
    ));
}

// ═══════════════════════════════════════════════════════════════════════════
//  REST / Fetch
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function getRetryAfterMs(v) {
    var n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.ceil(n < 1000 ? n * 1000 : n);
}

function getProfileFetchRetryDelay(err) {
    if (err && err.status === 429) {
        var ra = getRetryAfterMs(err && err.body && err.body.retry_after);
        if (ra != null) return Math.max(ra + 500, restSpacingMs);
        return rateLimitRetryMs;
    }
    if ([401, 403, 404].indexOf(Number(err && err.status)) >= 0) return unavailableProfileRetryMs;
    return null;
}

function noteRateLimit(err) {
    if (Number(err && err.status) !== 429) return;
    var d = getProfileFetchRetryDelay(err) || rateLimitRetryMs;
    nextRestRequestAt = Math.max(nextRestRequestAt, Date.now() + d);
}

async function queuedRestGet(opts) {
    var run = restQueue.then(async function () {
        var w = nextRestRequestAt - Date.now();
        if (w > 0) await sleep(w);
        try {
            var r = await (RestAPI.get.bind(RestAPI))(opts);
            nextRestRequestAt = Math.max(nextRestRequestAt, Date.now() + restSpacingMs);
            return r;
        } catch (e) {
            noteRateLimit(e);
            throw e;
        }
    });
    restQueue = run.catch(function () {});
    return run;
}

async function fetchUserById(userId) {
    if (!userId) return null;
    var retry = unavailableUsers.get(userId);
    if (retry && retry > Date.now()) return cachedUsersById.get(userId) || null;
    if (retry) unavailableUsers.delete(userId);

    var cached = getRawUser(userId);
    if (cached) {
        unavailableUsers.delete(userId);
        var raw = unwrapAliasedUserProxy(cached) || cached;
        cachedUsersById.set(userId, raw);
        return raw;
    }

    var inF = inFlightUserFetches.get(userId);
    if (inF) return inF;

    var p = (async function () {
        try {
            var response = await queuedRestGet({ url: Constants.Endpoints.USER(userId), oldFormErrors: true });
            var fu = response && response.body;
            if (fu && fu.id) {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: fu });
                var su = getRawUser(userId) || fu;
                var raw2 = unwrapAliasedUserProxy(su) || su;
                cachedUsersById.set(userId, raw2);
                unavailableUsers.delete(userId);
                return raw2;
            }
        } catch (e) {
            var rd = getProfileFetchRetryDelay(e);
            if (rd != null) unavailableUsers.set(userId, Date.now() + rd);
        }
        var c = cachedUsersById.get(userId);
        return c ? (unwrapAliasedUserProxy(c) || c) : null;
    })().then(function (v) { inFlightUserFetches.delete(userId); return v; });
    inFlightUserFetches.set(userId, p);
    return p;
}

async function loadDiscordUserProfile(userId, query) {
    var cached = getRawUserProfile(userId) || cachedProfilesByUserId.get(userId) || null;
    if (cached) return cached;

    FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_START", userId: userId });
    var opts = {
        url: Constants.Endpoints.USER_PROFILE(userId),
        query: query,
        oldFormErrors: true
    };
    try {
        var resp = await queuedRestGet(opts);
        var body = resp && resp.body;
        if (body && body.user && body.user.id) {
            FluxDispatcher.dispatch({ type: "USER_UPDATE", user: body.user });
        }
        await FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: body });
        if (query && query.guild_id && body && body.guild_member) {
            rememberGuildContext(query.guild_id, userId);
            var gm = normalizeGuildMember(query.guild_id, userId, body.guild_member);
            if (gm) {
                cachedGuildMembersByKey.set(getGuildMemberCacheKey(query.guild_id, userId), gm);
                try { GuildMemberStore && GuildMemberStore.emitChange && GuildMemberStore.emitChange(); } catch (_) {}
            }
            FluxDispatcher.dispatch({ type: "GUILD_MEMBER_PROFILE_UPDATE", guildId: query.guild_id, guildMember: body.guild_member });
        }
        var resolved = getRawUserProfile(userId) || null;
        if (resolved) cachedProfilesByUserId.set(userId, resolved);
        return resolved;
    } catch (e) {
        var rd = getProfileFetchRetryDelay(e);
        if (rd != null) unavailableProfiles.set(userId, Date.now() + rd);
        return cachedProfilesByUserId.get(userId) || null;
    }
}

function getProfileFetchQueries(userId) {
    var guildIds = new Set();
    var currentGuildId = getCurrentGuildContextId();
    var rememberedGuildId = userId ? lastKnownGuildContextByUserId.get(userId) || null : null;
    if (currentGuildId) guildIds.add(currentGuildId);
    if (rememberedGuildId) guildIds.add(rememberedGuildId);

    return Array.from(guildIds).map(function (guildId) {
        return { guild_id: guildId, with_mutual_guilds: true, with_mutual_friends_count: false };
    }).concat([{ with_mutual_guilds: false, with_mutual_friends_count: false }]);
}

async function fetchUserProfileById(userId) {
    if (!userId) return null;
    var inF = inFlightProfileFetches.get(userId);
    if (inF) return inF;

    var cached = getRawUserProfile(userId);
    if (cached) {
        unavailableProfiles.delete(userId);
        cachedProfilesByUserId.set(userId, cached);
        return cached;
    }

    var retry = unavailableProfiles.get(userId);
    if (retry && retry > Date.now()) return cachedProfilesByUserId.get(userId) || null;

    var p = (async function () {
        for (var qi = 0; qi < getProfileFetchQueries(userId).length; qi++) {
            try {
                await loadDiscordUserProfile(userId, getProfileFetchQueries(userId)[qi]);
                unavailableProfiles.delete(userId);
                var r = getRawUserProfile(userId) || null;
                if (r) cachedProfilesByUserId.set(userId, r);
                return r;
            } catch (e) {
                var rd = getProfileFetchRetryDelay(e);
                if (rd != null) {
                    unavailableProfiles.set(userId, Date.now() + rd);
                    return cachedProfilesByUserId.get(userId) || null;
                }
            }
        }
        unavailableProfiles.set(userId, Date.now() + profileRetryMs);
        return cachedProfilesByUserId.get(userId) || null;
    })().then(function (v) { inFlightProfileFetches.delete(userId); return v; });
    inFlightProfileFetches.set(userId, p);
    return p;
}

async function fetchUserPreview(userId) {
    var user = await fetchUserById(userId);
    if (!user) return null;
    var dn = readDiscordGlobalName(user) || readDiscordUsername(user);
    var avu = sourceUsersByTargetId.get(user.id) || user;
    var avUrl = getAvatarUrlForUser(avu);
    return { id: user.id, username: readDiscordUsername(user), displayName: dn, avatarUrl: avUrl };
}

// ─── Profile Request Caching ────────────────────────────────────────────
function extractProfileRequestUserId(url) {
    if (!url) return null;
    var m = url.match(/\/users\/(\d{17,20})\/profile(?=$|[/?])/i);
    return m ? m[1] : null;
}

function replaceProfileRequestUserId(url, userId) {
    return url.replace(/\/users\/\d{17,20}\/profile(?=$|[/?])/i, "/users/" + userId + "/profile");
}

function getAliasedProfileResponseCacheKey(requestedUserId, resolvedTargetUserId, query) {
    var qk = "";
    if (query) {
        qk = Object.entries(query)
            .filter(function (e) { return e[1] == null || ["string", "number", "boolean"].indexOf(typeof e[1]) >= 0; })
            .sort(function (a, b) { return a[0].localeCompare(b[0]); })
            .map(function (e) { return e[0] + ":" + String(e[1]); })
            .join("|");
    }
    return requestedUserId + "|" + resolvedTargetUserId + "|" + qk;
}

function rememberAliasedProfileResponse(cacheKey, response) {
    if (!cacheKey || !response || typeof response !== "object") return;
    cachedAliasedProfileResponsesByRequestKey.set(cacheKey, { cachedAt: Date.now(), response: { body: cloneLoose(response.body) } });
}

function getCachedAliasedProfileResponse(cacheKey, maxAgeMs) {
    var cached = cachedAliasedProfileResponsesByRequestKey.get(cacheKey);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > (maxAgeMs || Infinity)) return null;
    return { body: cloneLoose(cached.response.body) };
}

function buildLocalAliasedProfileResponse(requestedUserId, resolvedTargetUserId) {
    var sourceUser = sourceUsersByTargetId.get(resolvedTargetUserId) || null;
    var sourceSnapshot = sourceSnapshotsByTargetId.get(resolvedTargetUserId) || null;
    if (!sourceUser && !sourceSnapshot) return null;

    var cachedProfile = aliasedProfiles.get(resolvedTargetUserId);
    if (cachedProfile) {
        var body = cloneLoose(cachedProfile);
        return { body: requestedUserId === resolvedTargetUserId ? body : alignProfileIdentityToRequester(body, requestedUserId, resolvedTargetUserId) };
    }

    var sourceRecord = sourceSnapshot ? sourceSnapshot.rawProfile : null;
    var mp = buildMirroredProfileData(sourceUser, null, sourceSnapshot, sourceRecord);
    var body2 = applyMirroredProfileData(cloneLoose(sourceRecord || {}), mp, resolvedTargetUserId, sourceRecord);
    var sourceUserRecord = cloneLoose(sourceUser || (sourceSnapshot ? sourceSnapshot.rawUser : null));
    if (sourceUserRecord) {
        if (mp.sourceUserId) rewriteIds(sourceUserRecord, mp.sourceUserId, resolvedTargetUserId, 0);
        body2.user = sourceUserRecord;
    }
    var alignedBody = requestedUserId === resolvedTargetUserId ? body2 : alignProfileIdentityToRequester(body2, requestedUserId, resolvedTargetUserId);
    return { body: alignedBody };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Alias Management & Sync
// ═══════════════════════════════════════════════════════════════════════════

function normalizeAliases(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (a) { return a != null && typeof a === "object"; })
        .map(function (a) {
            return {
                id: typeof a.id === "string" && a.id.length ? a.id : genId(),
                targetUserId: typeof a.targetUserId === "string" ? a.targetUserId.trim() : "",
                sourceUserId: typeof a.sourceUserId === "string" ? a.sourceUserId.trim() : "",
                enabled: a.enabled !== false
            };
        })
        .filter(function (a) { return a.targetUserId.length > 0 && a.sourceUserId.length > 0; });
}

function createAlias(target, source, enabled) {
    return { id: genId(), targetUserId: target.trim(), sourceUserId: source.trim(), enabled: enabled !== false };
}

function getActiveAliases() {
    var local = storage.enabled ? normalizeAliases(storage.aliases).filter(function (a) { return a.enabled; }) : [];
    return local;
}

function rebuildPreferred(aliases) {
    preferredTargetUserIdsBySourceId.clear();
    mirrorTargetToSourceId.clear();
    for (var i = 0; i < aliases.length; i++) {
        mirrorTargetToSourceId.set(aliases[i].targetUserId, aliases[i].sourceUserId);
    }
    var targetsBySourceId = new Map();
    for (var j = 0; j < aliases.length; j++) {
        var a = aliases[j];
        var existing = targetsBySourceId.get(a.sourceUserId);
        if (existing) existing.push(a.targetUserId);
        else targetsBySourceId.set(a.sourceUserId, [a.targetUserId]);
    }
    var currentUserId = getCurrentUserId();
    targetsBySourceId.forEach(function (targetIds, sourceUserId) {
        var unique = Array.from(new Set(targetIds));
        if (unique.length === 1) { preferredTargetUserIdsBySourceId.set(sourceUserId, unique[0]); return; }
        if (currentUserId && unique.indexOf(currentUserId) >= 0) preferredTargetUserIdsBySourceId.set(sourceUserId, currentUserId);
    });
}

async function applyAlias(alias, nextAP, nextSP, nextSU, nextSS, prevAP, prevSP, prevSU, prevSS) {
    var prevSnap = prevSS.get(alias.targetUserId) || null;

    if (prevSnap && snapshotHasLoadedProfile(prevSnap)) {
        nextSS.set(alias.targetUserId, prevSnap);
        var mp = buildMirroredProfileData(null, null, prevSnap, prevSnap.rawProfile || null);
        var ap = buildAliasedProfile(alias.targetUserId, mp, prevSnap.rawProfile || null) || prevAP.get(alias.targetUserId) || null;
        if (ap) nextAP.set(alias.targetUserId, ap);
        var pu = prevSU.get(alias.targetUserId);
        if (pu) nextSU.set(alias.targetUserId, pu);
        void fetchUserById(alias.sourceUserId);
        void fetchUserProfileById(alias.sourceUserId);
        return true;
    }

    var sourceUser = await fetchUserById(alias.sourceUserId);

    if (!sourceUser && !prevSnap) {
        var psu = prevSU.get(alias.targetUserId);
        if (psu) nextSU.set(alias.targetUserId, psu);
        var psp = prevSP.get(alias.targetUserId) || null;
        if (psp) nextSP.set(alias.targetUserId, psp);
        var pap = prevAP.get(alias.targetUserId);
        if (pap) nextAP.set(alias.targetUserId, pap);
        return Boolean(psu || psp || pap);
    }

    var sourceProfile = (sourceUser ? getRawUserProfile(alias.sourceUserId) || cachedProfilesByUserId.get(alias.sourceUserId) : null) || prevSP.get(alias.targetUserId) || null;
    if (sourceUser && !sourceProfile) void fetchUserProfileById(alias.sourceUserId);
    var sourceSnap = sourceUser ? createUserAliasSnapshot(sourceUser, sourceProfile, prevSnap) : prevSnap;
    if (sourceSnap) nextSS.set(alias.targetUserId, sourceSnap);
    var sourceRecord = sourceProfile || (sourceSnap ? sourceSnap.rawProfile : null) || null;
    var mp2 = buildMirroredProfileData(sourceUser, sourceProfile, sourceSnap, sourceRecord);
    if (sourceUser) nextSU.set(alias.targetUserId, unwrapAliasedUserProxy(sourceUser) || sourceUser);
    if (sourceProfile && sourceUser) nextSP.set(alias.targetUserId, sourceProfile);
    var ap2 = buildAliasedProfile(alias.targetUserId, mp2, sourceRecord) || prevAP.get(alias.targetUserId) || null;
    if (ap2) nextAP.set(alias.targetUserId, ap2);
    return true;
}

function emitProfileStoreChange() {
    try { UserStore && UserStore.emitChange && UserStore.emitChange(); } catch (_) {}
    try { UserProfileStore && UserProfileStore.emitChange && UserProfileStore.emitChange(); } catch (_) {}
    try { PresenceStore && PresenceStore.emitChange && PresenceStore.emitChange(); } catch (_) {}
    try { GuildMemberStore && GuildMemberStore.emitChange && GuildMemberStore.emitChange(); } catch (_) {}
}

function requestSourceUserPresences(sourceUserIds) {
    var guildIds = [];
    try {
        if (GuildStore && typeof GuildStore.getGuildIds === "function") {
            guildIds = GuildStore.getGuildIds().filter(function (g) { return typeof g === "string" && g.length > 0; });
        } else if (GuildStore && typeof GuildStore.getGuilds === "function") {
            guildIds = Object.keys(GuildStore.getGuilds() || {});
        }
    } catch (_) {}
    if (guildIds.length === 0) return;

    var now = Date.now();
    var requested = Array.from(new Set(sourceUserIds)).filter(function (uid) {
        if (!uid) return false;
        var last = lastPresenceRequestBySourceUserId.get(uid) || 0;
        if (now - last < presenceCooldownMs) return false;
        lastPresenceRequestBySourceUserId.set(uid, now);
        return true;
    });
    if (requested.length === 0) return;

    for (var i = 0; i < requested.length; i += presenceBatchSize) {
        var userIds = requested.slice(i, i + presenceBatchSize);
        try {
            FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: guildIds, userIds: userIds, presences: true });
        } catch (_) {
            userIds.forEach(function (uid) { lastPresenceRequestBySourceUserId.delete(uid); });
        }
    }
}

async function runSync() {
    if (isSyncing) { syncQueued = true; return; }
    isSyncing = true;
    try {
        do {
            syncQueued = false;
            var aliases = getActiveAliases();
            var hadAP = aliasedProfiles.size > 0 || sourceUsersByTargetId.size > 0;
            rebuildPreferred(aliases);

            var prevAP = new Map(aliasedProfiles);
            var prevSP = new Map(sourceProfilesByTargetId);
            var prevSU = new Map(sourceUsersByTargetId);
            var prevSS = new Map(sourceSnapshotsByTargetId);
            var nextAP = new Map();
            var nextSP = new Map();
            var nextSU = new Map();
            var nextSS = new Map();
            var nextActiveSrc = new Set();
            var nextActiveProf = new Set();

            unavailableUsers.forEach(function (ra, uid) { if (ra <= Date.now()) unavailableUsers.delete(uid); });
            unavailableProfiles.forEach(function (ra, uid) { if (ra <= Date.now()) unavailableProfiles.delete(uid); });

            for (var j = 0; j < aliases.length; j++) {
                nextActiveSrc.add(aliases[j].sourceUserId);
                nextActiveProf.add(aliases[j].targetUserId);
                nextActiveProf.add(aliases[j].sourceUserId);
            }

            for (var k = 0; k < aliases.length; k++) {
                await applyAlias(aliases[k], nextAP, nextSP, nextSU, nextSS, prevAP, prevSP, prevSU, prevSS);
            }

            aliasedProfiles.clear();
            nextAP.forEach(function (p, uid) { aliasedProfiles.set(uid, p); });
            sourceProfilesByTargetId.clear();
            nextSP.forEach(function (p, uid) { sourceProfilesByTargetId.set(uid, p); });
            sourceUsersByTargetId.clear();
            nextSU.forEach(function (u, uid) { sourceUsersByTargetId.set(uid, u); });
            sourceSnapshotsByTargetId.clear();
            nextSS.forEach(function (s, uid) { sourceSnapshotsByTargetId.set(uid, s); });
            aliasedUserViews.clear();
            aliasedCurrentUserViews.clear();
            activeSourceUserIds.clear();
            nextActiveSrc.forEach(function (uid) { activeSourceUserIds.add(uid); });
            activeProfileUserIds.clear();
            nextActiveProf.forEach(function (uid) { activeProfileUserIds.add(uid); });

            requestSourceUserPresences(nextActiveSrc);

            if (hadAP || aliases.length > 0) emitProfileStoreChange();
        } while (syncQueued);
    } finally {
        isSyncing = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Patching — after/instead ONLY, never full method replacement
// ═══════════════════════════════════════════════════════════════════════════

function patchRuntimeGetters() {
    // Save originals via the store methods themselves (before any patching)
    if (!_origGetUser && UserStore && UserStore.getUser) _origGetUser = UserStore.getUser.bind(UserStore);
    if (!_origGetCurrentUser && UserStore && UserStore.getCurrentUser) _origGetCurrentUser = UserStore.getCurrentUser.bind(UserStore);
    if (!_origGetUserProfile && UserProfileStore && UserProfileStore.getUserProfile) _origGetUserProfile = UserProfileStore.getUserProfile.bind(UserProfileStore);
    if (!_origGetMember && GuildMemberStore && GuildMemberStore.getMember) _origGetMember = GuildMemberStore.getMember.bind(GuildMemberStore);

    // ── UserStore.getUser ──────────────────────────────────────────────
    if (_origGetUser) {
        patches.push(after("getUser", UserStore, function (args, ret) {
            if (!ret) return ret;
            var uid = args[0];
            var redirected = getProfileRedirectTargetUserId(uid) || uid;
            var user = redirected !== uid ? (_origGetUser(redirected) || ret) : ret;
            var curId = _origGetCurrentUser ? _origGetCurrentUser().id : null;
            return getAliasedUserView(user, { preserveAccountFields: Boolean(curId && user && user.id === curId) });
        }));
    }

    // ── UserStore.getCurrentUser ───────────────────────────────────────
    if (_origGetCurrentUser) {
        patches.push(after("getCurrentUser", UserStore, function (args, ret) {
            if (!ret) return ret;
            return getAliasedUserView(ret, { preserveAccountFields: true });
        }));
    }

    // ── UserStore.getUsers ─────────────────────────────────────────────
    if (UserStore && typeof UserStore.getUsers === "function") {
        patches.push(after("getUsers", UserStore, function (args, ret) {
            if (!ret || typeof ret !== "object") return ret;
            var next = Object.assign({}, ret);
            var curId = _origGetCurrentUser ? _origGetCurrentUser().id : null;
            for (var userId in ret) {
                next[userId] = getAliasedUserView(ret[userId], { preserveAccountFields: Boolean(curId && userId === curId) }) || ret[userId];
            }
            preferredTargetUserIdsBySourceId.forEach(function (targetUserId, sourceUserId) {
                var targetUser = ret[targetUserId] || (_origGetUser ? _origGetUser(targetUserId) : null);
                if (targetUser) {
                    next[sourceUserId] = getAliasedUserView(targetUser, { preserveAccountFields: Boolean(curId && targetUserId === curId) }) || targetUser;
                }
            });
            return next;
        }));
    }

    // ── UserProfileStore.getUserProfile ────────────────────────────────
    if (_origGetUserProfile) {
        patches.push(instead("getUserProfile", UserProfileStore, function (args) {
            var uid = args[0];
            var resolved = getProfileRedirectTargetUserId(uid) || uid;
            var cached = aliasedProfiles.get(resolved);
            if (cached) return alignProfileIdentityToRequester(cached, uid, resolved);
            var profile = _origGetUserProfile(resolved);
            if (!profile && resolved !== uid) profile = _origGetUserProfile(uid);
            return profile;
        }));
    }

    // ── UserProfileStore.getGuildMemberProfile ─────────────────────────
    if (UserProfileStore && UserProfileStore.getGuildMemberProfile) {
        var origGMProf = UserProfileStore.getGuildMemberProfile.bind(UserProfileStore);
        patches.push(instead("getGuildMemberProfile", UserProfileStore, function (args) {
            var uid = args[0];
            var guildId = args[1];
            var resolved = getProfileRedirectTargetUserId(uid) || uid;
            var srcId = getDirectMirroredSourceUserId(resolved);
            var contextGuildId = guildId || resolveGuildContext(uid, resolved, srcId);
            var srcGM = getNativeGuildMember(contextGuildId, srcId);
            rememberGuildContext(contextGuildId, uid, resolved, srcId);

            var profile = origGMProf(resolved, contextGuildId) || (resolved !== uid ? origGMProf(uid, contextGuildId) : null);
            var srcUser = sourceUsersByTargetId.get(resolved);
            var srcProfile = sourceProfilesByTargetId.get(resolved);
            var srcSnapshot = sourceSnapshotsByTargetId.get(resolved) || null;
            var srcMemberProfile = srcUser && contextGuildId && srcGM ? origGMProf(srcUser.id, contextGuildId) : null;
            var base = profile || (srcSnapshot ? cloneLoose(srcSnapshot.rawProfile || {}) : null);

            if (!base || (!srcUser && !srcSnapshot)) return profile;

            if (!srcGM || !srcMemberProfile) {
                var mp = buildMirroredProfileData(srcUser, srcProfile, srcSnapshot, srcSnapshot ? srcSnapshot.rawProfile : null);
                var np = applyMirroredSourceRecordData(cloneDiscordRecord(base), srcSnapshot ? srcSnapshot.rawProfile : null, mp, uid, { topLevelBadges: "clear", guildMemberProfileBadges: "clear" });
                if ((!np.pronouns || np.pronouns === "") && mp.pronouns) np.pronouns = mp.pronouns;
                return alignProfileIdentityToRequester(np, uid, resolved);
            }

            return alignProfileIdentityToRequester(applyMirroredSourceRecordData(
                base, srcMemberProfile || (srcSnapshot ? srcSnapshot.rawProfile : null),
                buildMirroredProfileData(srcUser, srcProfile, srcSnapshot, srcMemberProfile || (srcSnapshot ? srcSnapshot.rawProfile : null)),
                uid, { topLevelBadges: "clear", guildMemberProfileBadges: "clear" }
            ), uid, resolved);
        }));
    }

    // ── IconUtils.getUserAvatarURL ─────────────────────────────────────
    if (IconUtils && IconUtils.getUserAvatarURL) {
        var origAvatarURL = IconUtils.getUserAvatarURL.bind(IconUtils);
        patches.push(instead("getUserAvatarURL", IconUtils, function (args) {
            var user = args[0];
            if (user && user.id) {
                var src = sourceUsersByTargetId.get(user.id);
                var snap = sourceSnapshotsByTargetId.get(user.id);
                if (src) return origAvatarURL.apply(IconUtils, [src].concat(args.slice(1)));
                if (snap && snap.avatarUrl) return snap.avatarUrl;
            }
            return origAvatarURL.apply(IconUtils, args);
        }));
    }

    // ── IconUtils.getUserBannerURL ─────────────────────────────────────
    if (IconUtils && IconUtils.getUserBannerURL) {
        var origBannerURL = IconUtils.getUserBannerURL.bind(IconUtils);
        patches.push(instead("getUserBannerURL", IconUtils, function (args) {
            var data = args[0];
            if (!data || !data.id) return origBannerURL.apply(IconUtils, args);
            var src = sourceUsersByTargetId.get(data.id);
            var srcProfile = sourceProfilesByTargetId.get(data.id);
            var snap = sourceSnapshotsByTargetId.get(data.id);
            var bf = readBannerFields(src, srcProfile, snap, snap ? snap.rawProfile : null);

            if (isRawAssetUrl(data.banner)) return normalizeRawAssetUrl(data.banner) || data.banner;
            if (bf.bannerUrl) return bf.bannerUrl;
            if (!src && snap && snap.bannerHash) {
                return origBannerURL.apply(IconUtils, [{ id: snap.sourceUserId, banner: snap.bannerHash, canAnimate: data.canAnimate, size: data.size }]);
            }
            if (!src || !(srcProfile && srcProfile.banner)) return origBannerURL.apply(IconUtils, args);
            return origBannerURL.apply(IconUtils, [{ id: src.id, banner: srcProfile.banner, canAnimate: data.canAnimate, size: data.size }]);
        }));
    }

    // ── User prototype getAvatarURL / getAvatarSource ──────────────────
    var curUser = UserStore && UserStore.getCurrentUser ? UserStore.getCurrentUser() : null;
    var userProto = curUser ? Object.getPrototypeOf(curUser) : null;
    if (userProto && !patchedUserPrototype) {
        patchedUserPrototype = userProto;
        if (typeof userProto.getAvatarURL === "function") {
            originalPrototypeGetAvatarURL = userProto.getAvatarURL;
            userProto.getAvatarURL = function () {
                var src = this && this.id ? sourceUsersByTargetId.get(this.id) : null;
                var snap = this && this.id ? sourceSnapshotsByTargetId.get(this.id) : null;
                if (src) return getAvatarUrlForUser(src);
                if (snap && snap.avatarUrl) return snap.avatarUrl;
                return originalPrototypeGetAvatarURL.apply(this, arguments);
            };
        }
        if (typeof userProto.getAvatarSource === "function") {
            originalPrototypeGetAvatarSource = userProto.getAvatarSource;
            userProto.getAvatarSource = function () {
                var src = this && this.id ? sourceUsersByTargetId.get(this.id) : null;
                if (src && typeof src.getAvatarSource === "function") return src.getAvatarSource.apply(src, arguments);
                return originalPrototypeGetAvatarSource.apply(this, arguments);
            };
        }
    }

    // ── DisplayProfileUtils ────────────────────────────────────────────
    if (DisplayProfileUtils && DisplayProfileUtils.getDisplayProfile) {
        var origGetDP = DisplayProfileUtils.getDisplayProfile.bind(DisplayProfileUtils);
        patches.push(instead("getDisplayProfile", DisplayProfileUtils, function (args) {
            var uid = args[0];
            var guildId = args[1];
            var customStores = args[2];
            var resolved = getProfileRedirectTargetUserId(uid) || uid;
            var contextGuildId = guildId || resolveGuildContext(uid, resolved, getDirectMirroredSourceUserId(resolved));
            var srcId = getDirectMirroredSourceUserId(resolved);
            var srcGM = getNativeGuildMember(contextGuildId, srcId);
            rememberGuildContext(contextGuildId, uid, resolved, srcId);

            var displayProfile = origGetDP(resolved, contextGuildId, customStores)
                || (resolved !== uid ? origGetDP(uid, contextGuildId, customStores) : null);

            var srcUser = sourceUsersByTargetId.get(resolved);
            var srcProfile = sourceProfilesByTargetId.get(resolved);
            var srcSnapshot = sourceSnapshotsByTargetId.get(resolved) || null;
            var srcDP = srcUser && srcGM ? origGetDP(srcUser.id, contextGuildId, customStores) : null;
            var canUseSrcGP = Boolean(srcGM && srcDP);

            var mp = buildMirroredProfileData(srcUser, srcProfile, srcSnapshot, canUseSrcGP ? srcDP : (srcSnapshot ? srcSnapshot.rawProfile : null));
            var sourceRecord = canUseSrcGP ? srcDP : (srcSnapshot ? srcSnapshot.rawProfile : null);
            var base = displayProfile || (srcSnapshot ? cloneLoose(srcSnapshot.rawProfile || {}) : null);

            if (!base || (!srcUser && !srcSnapshot)) return displayProfile;

            return alignProfileIdentityToRequester(applyMirroredSourceRecordData(base, sourceRecord, mp, uid, { topLevelBadges: "clear", userProfileBadges: "mirror", guildMemberProfileBadges: "clear" }), uid, resolved);
        }));
    }

    if (DisplayProfileUtils && DisplayProfileUtils.useDisplayProfile && DisplayProfileUtils.getDisplayProfile) {
        var origUseDP = DisplayProfileUtils.useDisplayProfile.bind(DisplayProfileUtils);
        var _origGetDP2 = DisplayProfileUtils.getDisplayProfile.bind(DisplayProfileUtils);
        patches.push(instead("useDisplayProfile", DisplayProfileUtils, function (args) {
            var uid = args[0];
            var guildId = args[1];
            var customStores = args[2];
            var resolved = getProfileRedirectTargetUserId(uid) || uid;
            var contextGuildId = guildId || resolveGuildContext(uid, resolved, getDirectMirroredSourceUserId(resolved));
            var srcId = getDirectMirroredSourceUserId(resolved);
            var srcGM = getNativeGuildMember(contextGuildId, srcId);
            rememberGuildContext(contextGuildId, uid, resolved, srcId);

            var displayProfile = origUseDP(resolved, contextGuildId, customStores)
                || (resolved !== uid ? origUseDP(uid, contextGuildId, customStores) : null);

            var srcUser = sourceUsersByTargetId.get(resolved);
            var srcProfile = sourceProfilesByTargetId.get(resolved);
            var srcSnapshot = sourceSnapshotsByTargetId.get(resolved) || null;
            var srcDP = srcUser && srcGM ? _origGetDP2(srcUser.id, contextGuildId, customStores) : null;
            var canUseSrcGP = Boolean(srcGM && srcDP);

            var mp = buildMirroredProfileData(srcUser, srcProfile, srcSnapshot, canUseSrcGP ? srcDP : (srcSnapshot ? srcSnapshot.rawProfile : null));
            var sourceRecord = canUseSrcGP ? srcDP : (srcSnapshot ? srcSnapshot.rawProfile : null);
            var base = displayProfile || (srcSnapshot ? cloneLoose(srcSnapshot.rawProfile || {}) : null);

            if (!base || (!srcUser && !srcSnapshot)) return displayProfile;

            return alignProfileIdentityToRequester(applyMirroredSourceRecordData(base, sourceRecord, mp, uid, { topLevelBadges: "clear", userProfileBadges: "mirror", guildMemberProfileBadges: "clear" }), uid, resolved);
        }));
    }

    // ── GuildMemberStore ───────────────────────────────────────────────
    if (_origGetMember) {
        patches.push(instead("getMember", GuildMemberStore, function (args) {
            return buildMirroredGuildMember(args[0], args[1]);
        }));
    }

    if (GuildMemberStore && GuildMemberStore.getNick && _origGetMember) {
        var origGetNick = GuildMemberStore.getNick.bind(GuildMemberStore);
        patches.push(instead("getNick", GuildMemberStore, function (args) {
            var gm = buildMirroredGuildMember(args[0], args[1]);
            return gm ? gm.nick : origGetNick(args[0], args[1]);
        }));
    }

    if (GuildMemberStore && GuildMemberStore.isMember) {
        patches.push(after("isMember", GuildMemberStore, function (args, ret) {
            if (mirrorTargetToSourceId.has(args[1])) return true;
            return ret;
        }));
    }

    // ── PresenceStore ──────────────────────────────────────────────────
    if (PresenceStore) {
        if (PresenceStore.getActivities) {
            var origGetActs = PresenceStore.getActivities.bind(PresenceStore);
            patches.push(instead("getActivities", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return cloneLoose(origGetActs.apply(PresenceStore, [src || args[0]].concat(args.slice(1)))) || [];
            }));
        }
        if (PresenceStore.getUnfilteredActivities) {
            var origGetUActs = PresenceStore.getUnfilteredActivities.bind(PresenceStore);
            patches.push(instead("getUnfilteredActivities", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return cloneLoose(origGetUActs.apply(PresenceStore, [src || args[0]].concat(args.slice(1)))) || [];
            }));
        }
        if (PresenceStore.getPrimaryActivity) {
            var origGetPAct = PresenceStore.getPrimaryActivity.bind(PresenceStore);
            patches.push(instead("getPrimaryActivity", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return cloneLoose(origGetPAct(src || args[0], args[1]));
            }));
        }
        if (PresenceStore.findActivity) {
            var origFindAct = PresenceStore.findActivity.bind(PresenceStore);
            patches.push(instead("findActivity", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return cloneLoose(origFindAct(src || args[0], args[1], args[2]));
            }));
        }
        if (PresenceStore.getStatus) {
            var origGetStat = PresenceStore.getStatus.bind(PresenceStore);
            patches.push(instead("getStatus", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return origGetStat(src || args[0], args[1], args[2]);
            }));
        }
        if (PresenceStore.getClientStatus) {
            var origGetCS = PresenceStore.getClientStatus.bind(PresenceStore);
            patches.push(instead("getClientStatus", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return cloneLoose(origGetCS(src || args[0]));
            }));
        }
        if (PresenceStore.isMobileOnline) {
            var origIsMO = PresenceStore.isMobileOnline.bind(PresenceStore);
            patches.push(instead("isMobileOnline", PresenceStore, function (args) {
                var src = getPresenceSourceUserId(args[0]);
                return origIsMO(src || args[0]);
            }));
        }
        if (PresenceStore.getState) {
            var origGetPState = PresenceStore.getState.bind(PresenceStore);
            patches.push(instead("getState", PresenceStore, function (args) {
                var state = origGetPState();
                if (!state || mirrorTargetToSourceId.size === 0) return state;
                var next = Object.assign({}, state);
                var keyedStores = ["activities", "filteredActivities", "unfilteredActivities", "activityMetadata", "clientStatuses", "statuses"];
                for (var i = 0; i < keyedStores.length; i++) {
                    if (state[keyedStores[i]] && typeof state[keyedStores[i]] === "object") next[keyedStores[i]] = Object.assign({}, state[keyedStores[i]]);
                }
                mirrorTargetToSourceId.forEach(function (sourceUserId, targetUserId) {
                    if (next.activities && next.activities[sourceUserId]) next.activities[targetUserId] = cloneLoose(next.activities[sourceUserId]);
                    if (next.filteredActivities && next.filteredActivities[sourceUserId]) next.filteredActivities[targetUserId] = cloneLoose(next.filteredActivities[sourceUserId]);
                    if (next.unfilteredActivities && next.unfilteredActivities[sourceUserId]) next.unfilteredActivities[targetUserId] = cloneLoose(next.unfilteredActivities[sourceUserId]);
                    if (next.clientStatuses && next.clientStatuses[sourceUserId]) next.clientStatuses[targetUserId] = cloneLoose(next.clientStatuses[sourceUserId]);
                    if (next.statuses && next.statuses[sourceUserId]) next.statuses[targetUserId] = next.statuses[sourceUserId];
                });
                return next;
            }));
        }
    }

    // ── SnowflakeUtils.extractTimestamp ────────────────────────────────
    if (SnowflakeUtils && SnowflakeUtils.extractTimestamp) {
        patches.push(instead("extractTimestamp", SnowflakeUtils, function (args) {
            var id = args[0];
            var src = typeof id === "string" ? sourceUsersByTargetId.get(id) : null;
            var snap = typeof id === "string" ? sourceSnapshotsByTargetId.get(id) : null;
            return SnowflakeUtils.extractTimestamp.call(SnowflakeUtils, src ? src.id : (snap ? snap.sourceUserId : id));
        }));
    }

    // ── UsernameUtils ─────────────────────────────────────────────────
    if (UsernameUtils) {
        if (UsernameUtils.getName) {
            patches.push(instead("getName", UsernameUtils, function (args) {
                return mirroredName(args[0]);
            }));
        }
        if (UsernameUtils.useName) {
            var origUseName = UsernameUtils.useName.bind(UsernameUtils);
            patches.push(instead("useName", UsernameUtils, function (args) {
                var fallback = origUseName(args[0]);
                return mirroredName(args[0]) || fallback;
            }));
        }
        if (UsernameUtils.getGlobalName) {
            patches.push(instead("getGlobalName", UsernameUtils, function (args) {
                return getMirroredGlobalName(args[0]);
            }));
        }
        if (UsernameUtils.getFormattedName) {
            var origGetFN = UsernameUtils.getFormattedName.bind(UsernameUtils);
            patches.push(instead("getFormattedName", UsernameUtils, function (args) {
                return args[1] ? getMirroredUserTag(args[0], origGetFN(args[0], args[1])) : mirroredName(args[0]);
            }));
        }
        if (UsernameUtils.getUserTag) {
            var origGetUT = UsernameUtils.getUserTag.bind(UsernameUtils);
            patches.push(instead("getUserTag", UsernameUtils, function (args) {
                return getMirroredUserTag(args[0], origGetUT(args[0], args[1]));
            }));
        }
        if (UsernameUtils.useUserTag) {
            var origUseUT = UsernameUtils.useUserTag.bind(UsernameUtils);
            patches.push(instead("useUserTag", UsernameUtils, function (args) {
                var fallback = origUseUT(args[0], args[1]);
                return getMirroredUserTag(args[0], fallback);
            }));
        }
    }

    // ── RestAPI.get — profile request interception ─────────────────────
    if (RestAPI && RestAPI.get) {
        var origRestGet = RestAPI.get.bind(RestAPI);
        patches.push(instead("get", RestAPI, async function (args) {
            var opts = args[0];
            if (opts && opts.__wowBypassProfileRedirect) return origRestGet(opts);

            var requestedUserId = extractProfileRequestUserId(opts && opts.url);
            if (!requestedUserId) return origRestGet(opts);

            var resolvedTargetUserId = getProfileRedirectTargetUserId(requestedUserId) || requestedUserId;
            var sourceUserId = getDirectMirroredSourceUserId(resolvedTargetUserId);
            if (!sourceUserId) return origRestGet(opts);

            var nextQuery = opts && opts.query && typeof opts.query === "object" ? Object.assign({}, opts.query) : undefined;
            var contextGuildId = typeof (nextQuery && nextQuery.guild_id) === "string"
                ? nextQuery.guild_id
                : resolveGuildContext(requestedUserId, resolvedTargetUserId, sourceUserId);
            rememberGuildContext(contextGuildId, requestedUserId, resolvedTargetUserId, sourceUserId);

            if (contextGuildId && nextQuery && !nextQuery.guild_id) nextQuery.guild_id = contextGuildId;

            var cacheKey = getAliasedProfileResponseCacheKey(requestedUserId, resolvedTargetUserId, nextQuery);
            var cachedResp = getCachedAliasedProfileResponse(cacheKey, aliasProfileCacheTtlMs);
            if (cachedResp) return cachedResp;

            var localResp = buildLocalAliasedProfileResponse(requestedUserId, resolvedTargetUserId);
            if (localResp) {
                rememberAliasedProfileResponse(cacheKey, localResp);
                return localResp;
            }

            if (requestedUserId === resolvedTargetUserId) return origRestGet(opts);

            var retry = unavailableProfiles.get(resolvedTargetUserId);
            if (retry && retry > Date.now()) return origRestGet(opts);

            try {
                var response = await origRestGet(Object.assign({}, opts, {
                    url: replaceProfileRequestUserId(opts.url, resolvedTargetUserId),
                    query: nextQuery
                }));
                if (contextGuildId && response && response.body && response.body.guild_member) {
                    var gm = normalizeGuildMember(contextGuildId, resolvedTargetUserId, response.body.guild_member);
                    if (gm) cachedGuildMembersByKey.set(getGuildMemberCacheKey(contextGuildId, resolvedTargetUserId), gm);
                }
                rememberAliasedProfileResponse(cacheKey, response);
                return response;
            } catch (e) {
                var rd = getProfileFetchRetryDelay(e);
                if (rd != null) unavailableProfiles.set(resolvedTargetUserId, Date.now() + rd);
                var stale = getCachedAliasedProfileResponse(cacheKey);
                if (stale) return stale;
                throw e;
            }
        }));
    }
}

// ─── Unpatch All ─────────────────────────────────────────────────────────
function unpatchAll() {
    for (var i = 0; i < patches.length; i++) {
        try { patches[i](); } catch (_) {}
    }
    patches = [];
    _origGetUser = null;
    _origGetCurrentUser = null;
    _origGetUserProfile = null;
    _origGetMember = null;

    // Restore prototype methods
    if (patchedUserPrototype) {
        if (originalPrototypeGetAvatarURL) patchedUserPrototype.getAvatarURL = originalPrototypeGetAvatarURL;
        if (originalPrototypeGetAvatarSource) patchedUserPrototype.getAvatarSource = originalPrototypeGetAvatarSource;
        patchedUserPrototype = null;
        originalPrototypeGetAvatarURL = null;
        originalPrototypeGetAvatarSource = null;
    }
}

// ─── Flux Dispatcher Events ──────────────────────────────────────────────
function onUserUpdate(event) {
    if (suppressUserUpdateEvents > 0) return;
    var uid = event && event.user && event.user.id;
    if (!uid || !activeSourceUserIds.has(uid)) return;
    void runSync();
}

function onUserProfileUpdate(event) {
    var uid = event && (event.userId || (event.userProfile && event.userProfile.userId)) || null;
    if (!uid || !activeProfileUserIds.has(uid)) return;
    void runSync();
}

var dispatcherSubscribed = false;

// ─── Start / Stop Runtime ────────────────────────────────────────────────
function startRuntime() {
    if (dispatcherSubscribed) return;
    if (FluxDispatcher) {
        try {
            FluxDispatcher.subscribe("USER_UPDATE", onUserUpdate);
            FluxDispatcher.subscribe("USER_PROFILE_FETCH_SUCCESS", onUserProfileUpdate);
            FluxDispatcher.subscribe("USER_PROFILE_UPDATE_SUCCESS", onUserProfileUpdate);
            dispatcherSubscribed = true;
        } catch (_) {}
    }
    patchRuntimeGetters();
    void runSync();
}

function stopRuntime() {
    if (FluxDispatcher && dispatcherSubscribed) {
        try {
            FluxDispatcher.unsubscribe("USER_UPDATE", onUserUpdate);
            FluxDispatcher.unsubscribe("USER_PROFILE_FETCH_SUCCESS", onUserProfileUpdate);
            FluxDispatcher.unsubscribe("USER_PROFILE_UPDATE_SUCCESS", onUserProfileUpdate);
        } catch (_) {}
    }
    dispatcherSubscribed = false;
    unpatchAll();
    mirrorTargetToSourceId.clear();
    aliasedProfiles.clear();
    sourceSnapshotsByTargetId.clear();
    aliasedUserViews.clear();
    aliasedCurrentUserViews.clear();
    sourceProfilesByTargetId.clear();
    sourceUsersByTargetId.clear();
    cachedUsersById.clear();
    cachedProfilesByUserId.clear();
    cachedGuildMembersByKey.clear();
    cachedAliasedProfileResponsesByRequestKey.clear();
    inFlightUserFetches.clear();
    inFlightProfileFetches.clear();
    unavailableUsers.clear();
    unavailableProfiles.clear();
    activeSourceUserIds.clear();
    activeProfileUserIds.clear();
    preferredTargetUserIdsBySourceId.clear();
    lastKnownGuildContextByUserId.clear();
    lastPresenceRequestBySourceUserId.clear();
    nextRestRequestAt = 0;
    restQueue = Promise.resolve();
    emitProfileStoreChange();
}

function refreshAliases() {
    if (storage.enabled) startRuntime();
    else stopRuntime();
    void runSync();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Settings UI
// ═══════════════════════════════════════════════════════════════════════════

var C = {
    bg: "#2b2d31", bg2: "#1e1f22", inset: "#111214",
    text: "#f2f3f5", muted: "#949ba4", brand: "#5865f2",
    danger: "#ed4245", line: "#3f4147", green: "#23a559"
};

function Settings() {
    var _s = storage;
    var forceUpdate = React.useState(0);
    var setUpdate = forceUpdate[1];
    function refresh() { setUpdate(function (x) { return x + 1; }); }

    var aliases = normalizeAliases(_s.aliases);
    var draftState = React.useState({ target: "", source: "" });
    var draft = draftState[0];
    var setDraft = draftState[1];
    var previewMap = React.useState({});
    var pMap = previewMap[0];
    var setPMap = previewMap[1];
    var saving = React.useState(false);
    var isSaving = saving[0];
    var setSaving = saving[1];

    React.useEffect(function () {
        var ids = [];
        aliases.forEach(function (a) { ids.push(a.targetUserId, a.sourceUserId); });
        var t = draft.target ? extractUserId(draft.target) : null;
        var s = draft.source ? extractUserId(draft.source) : null;
        if (t) ids.push(t);
        if (s) ids.push(s);
        ids = Array.from(new Set(ids.filter(Boolean)));
        Promise.all(ids.map(function (id) {
            return fetchUserPreview(id).then(function (p) { return [id, p]; }).catch(function () { return [id, null]; });
        })).then(function (entries) {
            var m = {};
            entries.forEach(function (e) { m[e[0]] = e[1]; });
            setPMap(m);
        });
    }, [aliases, draft.target, draft.source]);

    function addAlias() {
        var tid = extractUserId(draft.target);
        var sid = extractUserId(draft.source);
        if (!tid || !sid) { showToast("enter valid ids", getAssetIDByName("Small")); return; }
        if (tid === sid) { showToast("use two different users", getAssetIDByName("Small")); return; }
        if (aliases.some(function (a) { return a.targetUserId === tid && a.sourceUserId === sid; })) {
            showToast("swap already exists", getAssetIDByName("Small")); return;
        }
        setSaving(true);
        Promise.all([fetchUserPreview(tid), fetchUserPreview(sid)]).then(function (results) {
            if (!results[0] || !results[1]) {
                showToast("could not find one of those users", getAssetIDByName("Small"));
                setSaving(false);
                return;
            }
            var enable = !aliases.some(function (a) { return a.enabled && a.targetUserId === tid; });
            _s.aliases = normalizeAliases(_s.aliases).concat([createAlias(tid, sid, enable)]);
            setDraft({ target: "", source: "" });
            if (!enable) showToast("saved disabled (user already active)", getAssetIDByName("Check"));
            refreshAliases();
            refresh();
        }).catch(function () {
            showToast("error", getAssetIDByName("Small"));
        }).finally(function () { setSaving(false); });
    }

    function toggleEnabled(aliasId, aliasTargetUserId, checked) {
        if (checked) {
            _s.aliases = normalizeAliases(_s.aliases).map(function (a) {
                return Object.assign({}, a, { enabled: a.id === aliasId ? true : a.targetUserId === aliasTargetUserId ? false : a.enabled });
            });
        } else {
            _s.aliases = normalizeAliases(_s.aliases).map(function (a) {
                return a.id === aliasId ? Object.assign({}, a, { enabled: false }) : a;
            });
        }
        refreshAliases();
        refresh();
    }

    function deleteAlias(id) {
        _s.aliases = normalizeAliases(_s.aliases).filter(function (a) { return a.id !== id; });
        refreshAliases();
        refresh();
    }

    function renderPreview(userId) {
        var p = pMap[userId];
        if (p && p.avatarUrl) {
            return React.createElement(Image, { source: { uri: p.avatarUrl }, style: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg2 } });
        }
        return React.createElement(View, { style: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg2, alignItems: "center", justifyContent: "center" } },
            React.createElement(Text, { style: { color: C.muted, fontSize: 13, fontWeight: "700" } }, userId.slice(0, 1).toUpperCase()));
    }

    function renderUserLine(userId) {
        var p = pMap[userId];
        var name = p ? p.displayName : userId;
        var meta = p ? "@" + p.username : "";
        return React.createElement(View, { style: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, backgroundColor: C.inset, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 } },
            renderPreview(userId),
            React.createElement(View, { style: { flex: 1, minWidth: 0, marginLeft: 8 } },
                React.createElement(Text, { numberOfLines: 1, style: { color: C.text, fontSize: 14, fontWeight: "600" } }, name),
                meta ? React.createElement(Text, { numberOfLines: 1, style: { color: C.muted, fontSize: 12 } }, meta) : null));
    }

    function section(label, content) {
        return React.createElement(View, { style: { marginBottom: 12 } },
            React.createElement(Text, { style: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase" } }, label),
            content);
    }

    return React.createElement(ScrollView, { style: { flex: 1, backgroundColor: C.bg }, contentContainerStyle: { padding: 16, paddingBottom: 64 } },
        React.createElement(Text, { style: { color: C.text, fontSize: 20, fontWeight: "700" } }, "Wow"),
        React.createElement(Text, { style: { color: C.muted, fontSize: 13, marginTop: 2, marginBottom: 16 } }, "Swap user identities locally."),
        section("New Swap", React.createElement(View, null,
            React.createElement(View, { style: { flexDirection: "row", marginBottom: 8 } },
                React.createElement(View, { style: { flex: 1, marginRight: 4 } },
                    React.createElement(TextInput, {
                        style: { backgroundColor: C.inset, color: C.text, borderRadius: 6, borderWidth: 1, borderColor: "#111214", paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
                        placeholder: "user to change", placeholderTextColor: "#6d6f78",
                        autoCorrect: false, autoCapitalize: "none",
                        value: draft.target,
                        onChangeText: function (v) { setDraft(function (d) { return { target: v, source: d.source }; }); }
                    })),
                React.createElement(View, { style: { flex: 1, marginLeft: 4 } },
                    React.createElement(TextInput, {
                        style: { backgroundColor: C.inset, color: C.text, borderRadius: 6, borderWidth: 1, borderColor: "#111214", paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
                        placeholder: "user to copy", placeholderTextColor: "#6d6f78",
                        autoCorrect: false, autoCapitalize: "none",
                        value: draft.source,
                        onChangeText: function (v) { setDraft(function (d) { return { target: d.target, source: v }; }); }
                    }))),
            React.createElement(TouchableOpacity, {
                onPress: addAlias,
                activeOpacity: 0.7,
                style: { backgroundColor: isSaving ? C.bg2 : C.brand, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" }
            }, React.createElement(Text, { style: { color: "#fff", fontSize: 13, fontWeight: "600" } }, isSaving ? "saving..." : "save swap")))),
        section("Saved (" + aliases.length + ")", aliases.length === 0
            ? React.createElement(View, { style: { borderWidth: 1, borderColor: C.line, borderRadius: 6, borderStyle: "dashed", backgroundColor: C.bg2, padding: 12, alignItems: "center" } },
                React.createElement(Text, { style: { color: C.muted, fontSize: 13 } }, "no swaps yet."))
            : React.createElement(View, null, aliases.map(function (alias) {
                var hasConflict = !alias.enabled && aliases.some(function (a) { return a.id !== alias.id && a.enabled && a.targetUserId === alias.targetUserId; });
                return React.createElement(View, { key: alias.id, style: { flexDirection: "row", alignItems: "center", backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 10, marginBottom: 6 } },
                    React.createElement(View, { style: { flexDirection: "row", flex: 1, alignItems: "center", minWidth: 0 } },
                        renderUserLine(alias.targetUserId),
                        React.createElement(Text, { style: { color: C.muted, fontSize: 12, fontWeight: "700", marginHorizontal: 6 } }, "→"),
                        renderUserLine(alias.sourceUserId)),
                    React.createElement(View, { style: { flexDirection: "row", alignItems: "center" } },
                        React.createElement(TouchableOpacity, {
                            onPress: function () { toggleEnabled(alias.id, alias.targetUserId, !alias.enabled); },
                            activeOpacity: 0.7,
                            style: { width: 36, height: 20, borderRadius: 10, backgroundColor: alias.enabled ? C.green : C.line, alignItems: "center", justifyContent: alias.enabled ? "flex-end" : "flex-start", paddingHorizontal: 2 }
                        }, React.createElement(View, { style: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" } })),
                        React.createElement(TouchableOpacity, {
                            onPress: function () { deleteAlias(alias.id); },
                            activeOpacity: 0.7,
                            style: { backgroundColor: C.danger, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, marginLeft: 8 }
                        }, React.createElement(Text, { style: { color: "#fff", fontSize: 12, fontWeight: "600" } }, "del"))),
                    hasConflict ? React.createElement(Text, { style: { color: "#faa81a", fontSize: 11, marginTop: 2 } }, "another swap for this user is active") : null);
            }))));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Plugin Export
// ═══════════════════════════════════════════════════════════════════════════

return {
    onLoad: function () {
        if (storage.enabled !== false) storage.enabled = true;
        if (storage.enabled) startRuntime();
        try { showToast("[Wow] enabled", getAssetIDByName("Check")); } catch (_) {}
    },
    onUnload: function () {
        stopRuntime();
    },
    settings: Settings
};

})()
