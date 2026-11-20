import { CHANNEL_SKILLS } from '@saas/shared';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';
import { AiUnavailableError, SkillRouterService } from './skill-router.service';

const actor = { organizationId: 'org-1', userId: 'user-1' };
const candidates = [
  {
    name: CHANNEL_SKILLS.BILL_FROM_DOCUMENT,
    description: 'Enter a supplier invoice as a draft bill.',
    examples: [],
  },
  {
    name: CHANNEL_SKILLS.EXPENSE_FROM_DOCUMENT,
    description: 'Claim an expense from its receipt.',
    examples: [],
  },
] as never[];
const photo = { buffer: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' };

function setup(data: unknown = { skill: 'expense.from_document', confidence: 0.9 }) {
  const ai = { generateStructured: jest.fn().mockResolvedValue({ data }) };
  return { router: new SkillRouterService(ai as never), ai };
}

describe('SkillRouterService.routeFile', () => {
  it('shows the model the file and the file-taking skills, and returns its pick', async () => {
    const { router, ai } = setup();
    const route = await router.routeFile(photo, candidates, actor);

    expect(route).toEqual({ skill: 'expense.from_document', confidence: 0.9 });
    const [feature, request, calledAs] = ai.generateStructured.mock.calls[0];
    expect(feature).toBe('channels.route_skill');
    expect(calledAs).toBe(actor);
    const [file, text] = request.messages[0].content;
    expect(file).toEqual({
      type: 'image',
      mimeType: 'image/jpeg',
      data: Buffer.from('jpeg-bytes').toString('base64'),
    });
    expect(text.text).toContain('bill.from_document');
    expect(text.text).toContain('expense.from_document');
    expect(request.jsonSchema.properties.skill.enum).toEqual([
      'bill.from_document',
      'expense.from_document',
      null,
    ]);
  });

  it('sends a PDF as a document', async () => {
    const { router, ai } = setup();
    await router.routeFile(
      { buffer: Buffer.from('pdf'), mimeType: 'application/pdf', filename: 'r.pdf' },
      candidates,
      actor,
    );
    expect(ai.generateStructured.mock.calls[0][1].messages[0].content[0]).toMatchObject({
      type: 'document',
      mimeType: 'application/pdf',
      filename: 'r.pdf',
    });
  });

  it('never acts on a skill it was not offered', async () => {
    const { router } = setup({ skill: 'quote.approve', confidence: 0.99 });
    await expect(router.routeFile(photo, candidates, actor)).resolves.toEqual({
      skill: null,
      confidence: 0.99,
    });
  });

  it('does not spend a model call on a file type no model reads', async () => {
    const { router, ai } = setup();
    const route = await router.routeFile(
      { buffer: Buffer.from('x'), mimeType: 'audio/ogg' },
      candidates,
      actor,
    );
    expect(route).toEqual({ skill: null, confidence: 0 });
    expect(ai.generateStructured).not.toHaveBeenCalled();
  });

  it('degrades, rather than fails, when AI is not set up', async () => {
    const { router, ai } = setup();
    ai.generateStructured.mockRejectedValue(new AiNotConfiguredException());
    await expect(router.routeFile(photo, candidates, actor)).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });
});
