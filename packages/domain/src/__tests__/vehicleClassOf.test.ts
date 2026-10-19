import { describe, expect, it } from 'vitest';
import { vehicleClassOf } from '../vehicleCatalog';

describe('the group a branch vehicle is in', () => {
  it('follows the business body type it is tied to', () => {
    expect(vehicleClassOf({ bodyTypeId: 'bt_biz_mana_tractor', name: 'Tractor', category: 'car' })).toBe('farm');
    expect(vehicleClassOf({ bodyTypeId: 'bt_biz_mana_auto', name: 'My auto', category: 'car' })).toBe('threeWheeler');
    expect(vehicleClassOf({ bodyTypeId: 'bt_biz_mana_shareVan', name: 'Magic', category: 'car' })).toBe('commercial');
    expect(vehicleClassOf({ bodyTypeId: 'bt_biz_mana_van', name: 'Eeco', category: 'car' })).toBe('car');
    expect(vehicleClassOf({ bodyTypeId: 'bt_biz_mana_lorry', name: 'Lorry', category: 'car' })).toBe('heavy');
  });

  it('falls back to the name, then the menu', () => {
    expect(vehicleClassOf({ bodyTypeId: null, name: 'Scooter', category: 'bike' })).toBe('twoWheeler');
    expect(vehicleClassOf({ bodyTypeId: null, name: 'Auto rickshaw', category: 'car' })).toBe('threeWheeler');
    expect(vehicleClassOf({ bodyTypeId: null, name: 'Ambulance', category: 'car' })).toBe('car');
    expect(vehicleClassOf({ bodyTypeId: null, name: 'Something', category: 'bike' })).toBe('twoWheeler');
  });
});
