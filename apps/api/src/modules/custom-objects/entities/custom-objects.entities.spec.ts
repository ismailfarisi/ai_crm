import { CustomObjectDefinition } from './custom-object-definition.entity';
import { CustomAttributeDefinition } from './custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from './custom-relationship-definition.entity';
import { CustomRecord } from './custom-record.entity';
import { CustomRecordLink } from './custom-record-link.entity';

describe('Custom Objects Entities', () => {
  it('instantiates CustomObjectDefinition with default values', () => {
    const obj = new CustomObjectDefinition();
    obj.tenantId = 'tenant-1';
    obj.name = 'Machinery';
    obj.singularName = 'Machine';
    obj.slug = 'machinery';
    obj.primaryAttributeSlug = 'serial';

    expect(obj.name).toBe('Machinery');
    expect(obj.isArchived).toBe(false);
  });

  it('instantiates CustomAttributeDefinition with default flags', () => {
    const attr = new CustomAttributeDefinition();
    attr.name = 'Serial';
    attr.slug = 'serial';
    attr.type = 'text';

    expect(attr.isRequired).toBe(false);
    expect(attr.isSearchable).toBe(true);
  });

  it('instantiates CustomRelationshipDefinition with default cardinality', () => {
    const rel = new CustomRelationshipDefinition();
    rel.sourceObjectId = 'obj-1';
    rel.targetType = 'custom_object';
    rel.name = 'Parent Machine';
    rel.slug = 'parent_machine';

    expect(rel.cardinality).toBe('many_to_one');
  });

  it('instantiates CustomRecord with empty values map', () => {
    const record = new CustomRecord();
    record.objectId = 'obj-1';
    record.values = { serial: 'SN-100' };

    expect(record.values.serial).toBe('SN-100');
  });

  it('instantiates CustomRecordLink', () => {
    const link = new CustomRecordLink();
    link.relationshipId = 'rel-1';
    link.sourceRecordId = 'rec-1';
    link.targetType = 'custom_object';
    link.targetRecordId = 'rec-2';

    expect(link.sourceRecordId).toBe('rec-1');
    expect(link.targetRecordId).toBe('rec-2');
  });
});
