/**
 * Indicative landed cost. This is a sanity check for the estimating team, not
 * customs advice — duty concessions, FTAs, valuation rules and GST deferral
 * all change the real number.
 */

export interface LandedCostInput {
  /** Goods value at the agreed Incoterm, in AUD. */
  goodsValueAud: number;
  /** Freight component of CIF, AUD. */
  freightAud: number;
  /** Marine insurance, AUD. */
  insuranceAud: number;
  /** Duty rate as a percentage, e.g. 5 for 5%. */
  dutyRatePct: number;
  /** GST rate as a percentage, e.g. 10. */
  gstRatePct: number;
}

export interface LandedCostResult {
  customsValueAud: number;
  cifAud: number;
  dutyAud: number;
  /** GST in Australia is levied on the value of the taxable importation. */
  votiAud: number;
  gstAud: number;
  totalLandedAud: number;
  lines: { label: string; amount: number; formula: string }[];
  disclaimer: string;
}

export function landedCost(input: LandedCostInput): LandedCostResult {
  const customsValueAud = input.goodsValueAud;
  const cifAud = customsValueAud + input.freightAud + input.insuranceAud;
  const dutyAud = (customsValueAud * input.dutyRatePct) / 100;
  const votiAud = cifAud + dutyAud;
  const gstAud = (votiAud * input.gstRatePct) / 100;
  const totalLandedAud = cifAud + dutyAud + gstAud;

  return {
    customsValueAud,
    cifAud,
    dutyAud,
    votiAud,
    gstAud,
    totalLandedAud,
    lines: [
      {
        label: 'Customs value (goods)',
        amount: customsValueAud,
        formula: 'goods value as declared',
      },
      { label: 'Freight', amount: input.freightAud, formula: 'from the selected estimate' },
      { label: 'Insurance', amount: input.insuranceAud, formula: 'as entered' },
      {
        label: `Duty @ ${input.dutyRatePct}%`,
        amount: dutyAud,
        formula: `${customsValueAud.toFixed(2)} x ${input.dutyRatePct}% (duty is on the customs value, not CIF)`,
      },
      {
        label: `GST @ ${input.gstRatePct}%`,
        amount: gstAud,
        formula: `(CIF ${cifAud.toFixed(2)} + duty ${dutyAud.toFixed(2)}) x ${input.gstRatePct}%`,
      },
    ],
    disclaimer:
      'Indicative only. Not customs advice — tariff classification, FTA concessions and valuation rules can change duty and GST materially.',
  };
}
