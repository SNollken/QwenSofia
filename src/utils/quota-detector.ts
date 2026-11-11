/**
 * Detects the "daily limit reached for this model" notice that Qwen returns
 * when an account exhausts the quota of a specific model.
 *
 * The notice arrives as regular answer content (the model is instructed to
 * tell the user to upgrade or pick another model), so it has to be matched
 * on the text itself. The upstream also sets `extra.update_member` on the
 * same event, but relying on that alone misses the cases where the message
 * is the only signal.
 *
 * The pattern list covers the languages Qwen serves the notice in, so the
 * failover works regardless of the account's locale.
 */

const QUOTA_PATTERNS: RegExp[] = [
  // English
  /you(?:'ve| have)? reached (?:today'?s|the) (?:daily )?(?:usage )?limit/i,
  /you(?:'ve| have)? hit (?:today'?s|the) (?:daily )?(?:usage )?limit/i,
  /daily (?:usage )?limit/i,
  /upgrade your membership/i,
  /reach(?:ed)? your (?:daily )?(?:usage )?limit/i,
  /usage limit (?:for|reached)/i,
  /switch to another model/i,
  /moved to another model/i,
  /quota (?:for|exceeded|reached)/i,
  // Portuguese
  /atingiu o limite de hoje/i,
  /atingiu o limite/i,
  /limite (?:de hoje|di[áa]rio)/i,
  /fa[çc]a upgrade da sua membership/i,
  /upgrade da sua membership/i,
  /mude para outro modelo/i,
  /mude para um outro modelo/i,
  /cotas?\b/i,
  /limite de uso/i,
  // Spanish
  /alcanzaste el l[ií]mite (?:de hoy|diario)/i,
  /l[ií]mite (?:de hoy|diario|de uso)/i,
  /actualiza tu membres[ií]a/i,
  /cambia a otro modelo/i,
  // German
  /du hast das (?:t[aä]gliche )?limit erreicht/i,
  /t[aä]gliches limit erreicht/i,
  /aktualisiere deine mitgliedschaft/i,
  /wechsle zu einem anderen modell/i,
  // French
  /vous avez atteint la limite (?:du jour|quotidienne)/i,
  /limite (?:du jour|quotidienne|d'utilisation)/i,
  /mettez [àa] niveau votre abonnement/i,
  /passez [àa] un autre mod[eè]le/i,
  // Italian
  /hai raggiunto il limite (?:di oggi|giornaliero)/i,
  /limite (?:di oggi|giornaliero|d'uso)/i,
  /aggiorna il tuo abbonamento/i,
  /passa a un altro modello/i,
  // Japanese
  /本日の利用制限/,/今日の利用制限/,/上限に達/,/プランをアップグレード/,/別のモデルに変更/,
  // Korean
  /오늘의 사용 한도/,/사용 한도에 도달/,/멤버십을 업그레이드/,/다른 모델로 전환/,
  // Chinese
  /已达(?:到)?今日(?:的)?(?:使用)?(?:限额|上限)/,
  /达到(?:了)?今日(?:的)?限额/,
  /每日(?:使用)?(?:额度|限额|上限)/,
  /(?:额度|配额)(?:已|不足|用尽|耗尽|达到|用完)/,
  /升级(?:你的)?会员/,
  /切换到其他模型/,
  /今日限额/,
  // Russian
  /вы достигли (?:сегодняшнего|дневного) лимита/i,
  /дневной лимит/i,
  /обновите (?:свою )?(?:подписку|членство)/i,
  /переключит[ьи]с[яь] на другую модель/i,
  // Dutch
  /je hebt de (?:dagelijkse )?limiet bereikt/i,
  /dagelijkse limiet/i,
  // Turkish
  /günlük (?:kullanım )?limitinize ulaştınız/i,
  /günlük limit/i,
];

/** Models the limit notice can name, e.g. "Qwen3.8-Max". */
const MODEL_NAME_PATTERN = /\bQwen[0-9][\w.-]*(?:-[A-Za-z][\w-]*)?/i;

/** Strips trailing punctuation that the model pattern may have captured. */
function trimModelName(name: string): string {
  return name.replace(/[.\-_:,;]+$/, '');
}

export const QUOTA_MESSAGE_MAX_LENGTH = 1000;

export interface QuotaLimitMatch {
  /** True when the text looks like a daily/model usage limit notice. */
  isQuotaLimit: boolean;
  /** Model mentioned in the notice, when it could be extracted. */
  model?: string;
}

/**
 * Detects the daily-limit notice and tries to extract the model it names.
 */
export function detectQuotaLimitMessage(content: string | null | undefined): QuotaLimitMatch {
  const text = (content || '').trim();
  if (!text || text.length > QUOTA_MESSAGE_MAX_LENGTH) {
    return { isQuotaLimit: false };
  }

  const isQuotaLimit = QUOTA_PATTERNS.some((re) => re.test(text));
  if (!isQuotaLimit) {
    return { isQuotaLimit: false };
  }

  const modelMatch = text.match(MODEL_NAME_PATTERN);
  return {
    isQuotaLimit: true,
    model: modelMatch ? trimModelName(modelMatch[0]) : undefined,
  };
}

/** Convenience wrapper for callers that only need the boolean. */
export function isQuotaLimitMessage(content: string | null | undefined): boolean {
  return detectQuotaLimitMessage(content).isQuotaLimit;
}

/**
 * Convenience wrapper for callers that only need the model name: returns the
 * model named in the notice, or `null` when the text is not a quota notice.
 */
export function quotaLimitModel(content: string | null | undefined): string | null {
  const { isQuotaLimit, model } = detectQuotaLimitMessage(content);
  return isQuotaLimit && model ? model : null;
}
