import { HierarchicalToolRouterService } from './hierarchical-tool-router.service';

describe('HierarchicalToolRouterService', () => {
  let router: HierarchicalToolRouterService;
  let mockAi: any;

  beforeEach(() => {
    mockAi = {
      generateStructured: jest.fn(),
    };
    router = new HierarchicalToolRouterService(mockAi);
  });

  it('classifies sales message into SALES domain cluster', async () => {
    mockAi.generateStructured.mockResolvedValue({
      data: { domain: 'SALES', confidence: 0.95 },
      model: 'claude-sonnet-5',
    });

    const domain = await router.classifyDomain('Create quote for Acme 100 units', {
      organizationId: 'org-1',
      userId: 'usr-1',
    });

    expect(domain.domain).toBe('SALES');
    expect(domain.confidence).toBe(0.95);
  });

  it('degrades to GENERAL domain with 0.5 confidence if AI call fails', async () => {
    mockAi.generateStructured.mockRejectedValue(new Error('AI provider error'));

    const domain = await router.classifyDomain('Random message', {
      organizationId: 'org-1',
      userId: 'usr-1',
    });

    expect(domain.domain).toBe('GENERAL');
    expect(domain.confidence).toBe(0.5);
  });

  it('filters tools by RBAC permissions and matched domain', () => {
    const mockSkills: any[] = [
      { name: 'quote.create', domain: 'SALES', requiredPermission: 'quotes:create' },
      { name: 'quote.approve', domain: 'SALES', requiredPermission: 'quotes:approve' },
      { name: 'work_order.log', domain: 'PRODUCTION', requiredPermission: 'production:update' },
    ];

    const authorized = router.filterAuthorizedTools('SALES', ['quotes:create'], mockSkills);
    expect(authorized.map((s) => s.name)).toEqual(['quote.create']);
  });

  it('allows tools with no requiredPermission and allows wildcard permissions', () => {
    const mockSkills: any[] = [
      { name: 'general.help', domain: 'GENERAL' },
      { name: 'quote.create', domain: 'SALES', requiredPermission: 'quotes:create' },
      { name: 'quote.approve', domain: 'SALES', requiredPermission: 'quotes:approve' },
      { name: 'work_order.log', domain: 'PRODUCTION', requiredPermission: 'production:update' },
    ];

    // Admin wildcard allows all tools in the domain (and general)
    const adminAuthorized = router.filterAuthorizedTools('SALES', ['admin'], mockSkills);
    expect(adminAuthorized.map((s) => s.name)).toEqual(['general.help', 'quote.create', 'quote.approve']);

    // Star wildcard allows all
    const starAuthorized = router.filterAuthorizedTools('PRODUCTION', ['*'], mockSkills);
    expect(starAuthorized.map((s) => s.name)).toEqual(['general.help', 'work_order.log']);

    // GENERAL domain allows all domains matching permissions
    const generalAuthorized = router.filterAuthorizedTools('GENERAL', ['quotes:create'], mockSkills);
    expect(generalAuthorized.map((s) => s.name)).toEqual(['general.help', 'quote.create']);
  });
});
