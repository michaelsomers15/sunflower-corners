// Helpers for Amazon affiliate ("Our Picks") links.

const AMAZON_HOST = /(^|\.)amazon\.com$/i;
const AMAZON_SHORT_HOST = /^(amzn\.to|a\.co)$/i;
const TAG_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;

// Only plain web links are allowed — blocks javascript:, data:, etc.
function isSafeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function isAmazonUrl(raw) {
  try {
    const host = new URL(raw).hostname;
    return AMAZON_HOST.test(host) || AMAZON_SHORT_HOST.test(host);
  } catch (e) {
    return false;
  }
}

// Adds (or replaces) the Associate tracking tag on full amazon.com links.
// Short links (amzn.to / a.co from SiteStripe) already carry the tag and
// can't be modified, so they pass through untouched, as does anything
// that isn't Amazon or when no valid tag is configured yet.
function withAffiliateTag(raw, tag) {
  const cleanTag = String(tag || '').trim();
  if (!isSafeUrl(raw)) return '#';
  if (!TAG_FORMAT.test(cleanTag)) return raw;
  try {
    const u = new URL(raw);
    if (!AMAZON_HOST.test(u.hostname)) return raw;
    u.searchParams.set('tag', cleanTag);
    return u.toString();
  } catch (e) {
    return raw;
  }
}

function amazonSearchUrl(keywords) {
  return 'https://www.amazon.com/s?k=' + encodeURIComponent(keywords).replace(/%20/g, '+');
}

module.exports = { isSafeUrl, isAmazonUrl, withAffiliateTag, amazonSearchUrl, TAG_FORMAT };
