import { currentQuotaPeriod } from '../src/users/users.service';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';
import type { TestUser } from './support/tokens';

const INTERNAL_KEY = process.env.INTERNAL_API_KEY as string;
const PERIOD = currentQuotaPeriod('America/Mexico_City');

describe('Piggy: conversaciones y turnos internos (e2e)', () => {
  let testApp: TestApp;
  const valeria: TestUser = {
    sub: 'sub-valeria-piggy',
    name: 'Valeria',
    groups: ['premium'],
  };
  const beto: TestUser = {
    sub: 'sub-beto-piggy',
    name: 'Beto',
    groups: ['premium'],
  };
  const normal: TestUser = { sub: 'sub-normal-piggy', name: 'Normal' };

  beforeAll(async () => {
    await resetDatabase();
    testApp = await createTestApp();
    // El primer GET /me crea al usuario y guarda su plan según el grupo.
    for (const user of [valeria, beto, normal]) {
      await testApp.as(user).get('/me').expect(200);
    }
  });

  afterAll(() => testApp.close());

  const internal = () => ({
    start: (body: Record<string, unknown>) =>
      testApp
        .anonymous()
        .post('/api/v1/internal/chat-turns')
        .set('x-internal-api-key', INTERNAL_KEY)
        .send(body),
    finish: (turnId: string, body: Record<string, unknown>) =>
      testApp
        .anonymous()
        .patch(`/api/v1/internal/chat-turns/${turnId}`)
        .set('x-internal-api-key', INTERNAL_KEY)
        .send(body),
  });

  const completed = (changes: Record<string, unknown> = {}) => ({
    status: 'completed',
    assistantMessage: 'Tu BBVA Oro vence primero: el 2 de noviembre.',
    toolsUsed: ['list_cards'],
    inputTokens: 1830,
    outputTokens: 120,
    title: null,
    ...changes,
  });

  async function setUsage(user: TestUser, queries: number, tokens: number) {
    await testApp.dataSource.query(
      `INSERT INTO cuotas_ia (usuario_id, periodo, consultas_usadas, tokens_usados)
       SELECT id, $2, $3, $4 FROM usuarios WHERE cognito_sub = $1
       ON CONFLICT (usuario_id, periodo)
       DO UPDATE SET consultas_usadas = EXCLUDED.consultas_usadas, tokens_usados = EXCLUDED.tokens_usados`,
      [user.sub, PERIOD, queries, tokens],
    );
  }

  it('abre un turno en una conversación nueva, lo cierra y queda en el historial', async () => {
    const content =
      '¿Qué tarjeta vence primero? Quiero saber cuál pago antes de la quincena.';
    const started = await internal()
      .start({ userSub: valeria.sub, conversationId: null, content })
      .expect(201);
    expect(started.body).toEqual({
      turnId: expect.stringMatching(/^\d+$/),
      conversationId: expect.any(String),
      history: [],
      aiUsage: { period: PERIOD, queriesUsed: 1, tokensUsed: 0 },
    });

    const finished = await internal()
      .finish(started.body.turnId, completed())
      .expect(200);
    expect(finished.body).toEqual({
      message: {
        id: expect.stringMatching(/^\d+$/),
        role: 'assistant',
        content: 'Tu BBVA Oro vence primero: el 2 de noviembre.',
        createdAt: expect.stringMatching(/-0[56]:00$/),
      },
      aiUsage: { period: PERIOD, queriesUsed: 1, tokensUsed: 1950 },
    });

    const list = await testApp.as(valeria).get('/conversations').expect(200);
    expect(list.body).toEqual([
      {
        id: started.body.conversationId,
        // Los primeros 60 caracteres del primer mensaje.
        title: content.slice(0, 60),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
    const detail = await testApp
      .as(valeria)
      .get(`/conversations/${started.body.conversationId}`)
      .expect(200);
    expect(
      detail.body.messages.map((message: { role: string }) => message.role),
    ).toEqual(['user', 'assistant']);
    const [{ tools }] = await testApp.dataSource.query(
      `SELECT herramientas_usadas AS tools FROM mensajes_chat WHERE id = $1`,
      [finished.body.message.id],
    );
    expect(tools).toEqual(['list_cards']);
  });

  it('el siguiente turno trae solo los últimos 10 mensajes y el título que manda el wrapper', async () => {
    const first = await internal()
      .start({ userSub: beto.sub, content: 'Hola' })
      .expect(201);
    await internal()
      .finish(first.body.turnId, completed({ title: 'Saludo' }))
      .expect(200);
    const conversationId = first.body.conversationId;
    for (let index = 0; index < 5; index++) {
      const turn = await internal()
        .start({
          userSub: beto.sub,
          conversationId,
          content: `Pregunta ${index}`,
        })
        .expect(201);
      await internal()
        .finish(
          turn.body.turnId,
          completed({ assistantMessage: `Respuesta ${index}` }),
        )
        .expect(200);
    }
    const next = await internal()
      .start({ userSub: beto.sub, conversationId, content: 'Otra' })
      .expect(201);
    expect(next.body.history).toHaveLength(10);
    expect(next.body.history[0].content).toBe('Pregunta 0');
    expect(next.body.history[9].content).toBe('Respuesta 4');
    await internal().finish(next.body.turnId, { status: 'failed' }).expect(200);

    const detail = await testApp
      .as(beto)
      .get(`/conversations/${conversationId}`)
      .expect(200);
    expect(detail.body.title).toBe('Saludo');
    // En orden cronológico aunque los ids pasen de 9 a 10 (BIGINT, no texto).
    const contents = detail.body.messages.map(
      (message: { content: string }) => message.content,
    );
    expect(contents).toHaveLength(12);
    expect(contents.slice(2, 4)).toEqual(['Pregunta 0', 'Respuesta 0']);
    expect(contents.at(-1)).toBe('Respuesta 4');
  });

  it('un turno fallido devuelve la consulta y saca el mensaje; si era el único, la conversación desaparece', async () => {
    await setUsage(valeria, 10, 0);
    const started = await internal()
      .start({ userSub: valeria.sub, content: 'Esto va a fallar' })
      .expect(201);
    expect(started.body.aiUsage.queriesUsed).toBe(11);
    const failed = await internal()
      .finish(started.body.turnId, { status: 'failed' })
      .expect(200);
    expect(failed.body).toEqual({
      message: null,
      aiUsage: { period: PERIOD, queriesUsed: 10, tokensUsed: 0 },
    });
    await testApp
      .as(valeria)
      .get(`/conversations/${started.body.conversationId}`)
      .expect(404);
  });

  it('no deja cerrar dos veces el mismo turno', async () => {
    const started = await internal()
      .start({ userSub: valeria.sub, content: 'Una vez' })
      .expect(201);
    const twice = await Promise.all([
      internal().finish(started.body.turnId, completed()),
      internal().finish(started.body.turnId, completed()),
    ]);
    expect(
      twice.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    await internal()
      .finish(started.body.turnId, { status: 'failed' })
      .expect(409);
    await internal().finish('999999999', completed()).expect(404);
    await internal().finish('abc', completed()).expect(404);
  });

  it('cinco turnos a la vez con dos consultas libres: pasan dos y el resto recibe 429', async () => {
    // El plan premium de la semilla: 100 consultas al mes.
    await setUsage(beto, 98, 0);
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        internal().start({ userSub: beto.sub, content: `Simultáneo ${index}` }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(2);
    const rejected = responses.filter((response) => response.status === 429);
    expect(rejected).toHaveLength(3);
    expect(rejected[0].body.error.code).toBe('quota_exceeded');
    const [{ queries }] = await testApp.dataSource.query(
      `SELECT q.consultas_usadas AS queries FROM cuotas_ia q JOIN usuarios u ON u.id = q.usuario_id
       WHERE u.cognito_sub = $1 AND q.periodo = $2`,
      [beto.sub, PERIOD],
    );
    expect(queries).toBe(100);

    // Sin tokens también se acaba, aunque queden consultas.
    await setUsage(beto, 0, 200_000);
    await internal()
      .start({ userSub: beto.sub, content: 'Sin tokens' })
      .expect(429);
  });

  it('el plan de la BD manda: un usuario normal no abre turnos aunque el wrapper lo pida', async () => {
    const response = await internal()
      .start({ userSub: normal.sub, content: 'Hola' })
      .expect(403);
    expect(response.body.error.code).toBe('premium_required');
    await internal()
      .start({ userSub: 'sub-que-no-existe', content: 'Hola' })
      .expect(404);
  });

  it('valida el turno y no deja escribir en la conversación de otro', async () => {
    const mine = await internal()
      .start({ userSub: valeria.sub, content: 'Mía' })
      .expect(201);
    await internal().finish(mine.body.turnId, completed()).expect(200);
    await internal()
      .start({
        userSub: beto.sub,
        conversationId: mine.body.conversationId,
        content: 'Intruso',
      })
      .expect(404);
    for (const [body, field] of [
      [{ userSub: valeria.sub, content: 'x'.repeat(2001) }, 'content'],
      [{ userSub: valeria.sub, content: '   ' }, 'content'],
      [
        { userSub: valeria.sub, content: 'Hola', conversationId: 'no-es-uuid' },
        'conversationId',
      ],
    ] as const) {
      const invalid = await internal().start(body).expect(422);
      expect(invalid.body.error.fields).toHaveProperty([field]);
    }
    const turn = await internal()
      .start({ userSub: valeria.sub, content: 'Turno' })
      .expect(201);
    await internal()
      .finish(turn.body.turnId, { status: 'cancelado' })
      .expect(422);
    await internal()
      .finish(turn.body.turnId, completed({ inputTokens: -1 }))
      .expect(422);
  });

  it('las rutas internas piden la llave; el historial, ser premium', async () => {
    const withoutKey = await testApp
      .anonymous()
      .post('/api/v1/internal/chat-turns')
      .send({ userSub: valeria.sub, content: 'Hola' })
      .expect(403);
    expect(withoutKey.body.error.code).toBe('forbidden');
    // El JWT de un usuario no abre las rutas internas.
    await testApp
      .as(valeria)
      .post('/internal/chat-turns')
      .send({ userSub: valeria.sub, content: 'Hola' })
      .expect(403);

    const forbidden = await testApp
      .as(normal)
      .get('/conversations')
      .expect(403);
    expect(forbidden.body.error.code).toBe('premium_required');
  });

  it('borra una conversación con sus mensajes; la de otro usuario es 404', async () => {
    const [conversation] = (
      await testApp.as(valeria).get('/conversations').expect(200)
    ).body;
    await testApp.as(beto).get(`/conversations/${conversation.id}`).expect(404);
    await testApp
      .as(beto)
      .delete(`/conversations/${conversation.id}`)
      .expect(404);
    await testApp
      .as(valeria)
      .delete(`/conversations/${conversation.id}`)
      .expect(204);
    await testApp
      .as(valeria)
      .get(`/conversations/${conversation.id}`)
      .expect(404);
    const [{ total }] = await testApp.dataSource.query(
      `SELECT count(*)::int AS total FROM mensajes_chat WHERE conversacion_id = $1`,
      [conversation.id],
    );
    expect(total).toBe(0);
  });
});
