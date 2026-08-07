// Formats timestamps in the farm's local time zone (America/Chicago) and
// always shows the UTC offset explicitly, per house preference.
const TIME_ZONE = 'America/Chicago';

function formatLocal(date) {
  if (!date) return '';
  const d = new Date(date);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

  // Compute the numeric UTC offset for this instant in America/Chicago (handles DST).
  const offsetDtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, timeZoneName: 'shortOffset'
  });
  const parts = offsetDtf.formatToParts(d);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  const offset = tzPart ? tzPart.value.replace('GMT', 'UTC') : '';

  return `${dtf.format(d)} (${offset})`;
}

module.exports = { formatLocal, TIME_ZONE };
