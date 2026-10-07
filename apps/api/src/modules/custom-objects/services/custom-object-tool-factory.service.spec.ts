import { CustomObjectToolFactoryService } from './custom-object-tool-factory.service';

describe('CustomObjectToolFactoryService', () => {
  let factory: CustomObjectToolFactoryService;

  beforeEach(() => {
    factory = new CustomObjectToolFactoryService();
  });

  it('generates query and create tool schemas for a given custom object', () => {
    const mockCustomObject: any = {
      id: 'co-1',
      name: 'Vehicle',
      slug: 'vehicle',
      description: 'Fleet transport asset',
      attributes: [
        { key: 'vin', label: 'VIN', type: 'TEXT', isRequired: true },
        { key: 'mileage', label: 'Mileage', type: 'NUMBER', isRequired: false },
      ],
    };

    const tools = factory.createDynamicTools([mockCustomObject]);
    expect(tools.length).toBe(2);

    const queryTool = tools.find((t) => t.name === 'query_custom_vehicle');
    const createTool = tools.find((t) => t.name === 'create_custom_vehicle');

    expect(queryTool).toBeDefined();
    expect(createTool).toBeDefined();
    expect(createTool?.jsonSchema.required).toContain('vin');
  });

  it('handles slug sanitization with uppercase and special characters', () => {
    const mockCustomObject: any = {
      id: 'co-2',
      name: 'Heavy Equipment',
      slug: 'Heavy-Equipment@2026',
      description: 'Heavy machinery units',
      attributes: [
        { key: 'serial_no', label: 'Serial No', type: 'TEXT', isRequired: true },
        { key: 'is_active', label: 'Is Active', type: 'BOOLEAN', isRequired: false },
      ],
    };

    const tools = factory.createDynamicTools([mockCustomObject]);
    expect(tools.length).toBe(2);

    const queryTool = tools.find((t) => t.name === 'query_custom_heavy_equipment_2026');
    const createTool = tools.find((t) => t.name === 'create_custom_heavy_equipment_2026');

    expect(queryTool).toBeDefined();
    expect(queryTool?.domain).toBe('CUSTOM_OBJECTS');
    expect(queryTool?.isMutating).toBe(false);

    expect(createTool).toBeDefined();
    expect(createTool?.domain).toBe('CUSTOM_OBJECTS');
    expect(createTool?.isMutating).toBe(true);
    expect(createTool?.jsonSchema.properties).toEqual({
      serial_no: { type: 'string', description: 'Serial No' },
      is_active: { type: 'boolean', description: 'Is Active' },
    });
    expect(createTool?.jsonSchema.required).toEqual(['serial_no']);
    expect(createTool?.jsonSchema.additionalProperties).toBe(false);
  });

  it('handles custom object with slug/name attributes and empty attributes list', () => {
    const mockWithSlugAttrs: any = {
      id: 'co-3',
      name: 'Sensor',
      slug: 'sensor',
      attributes: [
        { slug: 'firmware_version', name: 'Firmware Version', type: 'text', isRequired: true },
        { slug: 'battery_level', name: 'Battery Level', type: 'number', isRequired: false },
      ],
    };

    const mockEmptyAttrs: any = {
      id: 'co-4',
      name: 'EmptyObject',
      slug: 'empty_object',
    };

    const tools = factory.createDynamicTools([mockWithSlugAttrs, mockEmptyAttrs]);
    expect(tools.length).toBe(4);

    const createSensorTool = tools.find((t) => t.name === 'create_custom_sensor');
    expect(createSensorTool?.jsonSchema.properties).toEqual({
      firmware_version: { type: 'string', description: 'Firmware Version' },
      battery_level: { type: 'number', description: 'Battery Level' },
    });
    expect(createSensorTool?.jsonSchema.required).toContain('firmware_version');

    const createEmptyTool = tools.find((t) => t.name === 'create_custom_empty_object');
    expect(createEmptyTool?.jsonSchema.properties).toEqual({});
    expect(createEmptyTool?.jsonSchema.required).toEqual([]);
  });
});
