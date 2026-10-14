import type { Material, PrinterStatus } from '@print3d/api-contracts';
import {
  formatDiameter,
  isReinforcedMaterial,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  NOZZLE_MATERIAL_LABELS,
  NOZZLE_MATERIAL_ORDER,
  STATUS_LABELS,
  STATUS_ORDER,
} from './printer-labels';

// The label tables are `Record`s over the contract types, so the compiler already rejects a
// missing key. These tests also pin the Spanish text and the option order.
describe('printer labels', () => {
  it('labels every printer status in Spanish', () => {
    expect(STATUS_LABELS).toEqual({
      available: 'Disponible',
      in_use: 'En uso',
      maintenance: 'En mantenimiento',
    });
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(STATUS_LABELS).sort());
  });

  it('labels every one of the 14 materials', () => {
    const expected: Material[] = [
      'PLA',
      'PETG',
      'ABS',
      'ASA',
      'TPU',
      'PA',
      'PC',
      'HIPS',
      'PVA',
      'PP',
      'PLA_CF',
      'PETG_CF',
      'PA_CF',
      'PA_GF',
    ];

    expect(Object.keys(MATERIAL_LABELS).sort()).toEqual([...expected].sort());
    expect([...MATERIAL_ORDER].sort()).toEqual([...expected].sort());
    expect(MATERIAL_LABELS.PA_CF).toBe('Nailon con fibra de carbono (PA-CF)');
    expect(MATERIAL_LABELS.PC).toBe('Policarbonato (PC)');
  });

  it('labels every nozzle material in Spanish', () => {
    expect(NOZZLE_MATERIAL_LABELS).toEqual({
      brass: 'Latón',
      hardened_steel: 'Acero endurecido',
      stainless_steel: 'Acero inoxidable',
    });
    expect([...NOZZLE_MATERIAL_ORDER].sort()).toEqual(Object.keys(NOZZLE_MATERIAL_LABELS).sort());
  });

  it('never shows a raw status code as a label', () => {
    const raw: PrinterStatus = 'in_use';

    expect(STATUS_LABELS[raw]).not.toContain('_');
  });

  it('flags only fibre-reinforced materials', () => {
    const reinforced = MATERIAL_ORDER.filter((material) => isReinforcedMaterial(material));

    expect(reinforced).toEqual(['PLA_CF', 'PETG_CF', 'PA_CF', 'PA_GF']);
  });

  it('formats a nozzle diameter with a decimal comma', () => {
    expect(formatDiameter(0.4)).toBe('0,4 mm');
    expect(formatDiameter(1)).toBe('1 mm');
  });
});
