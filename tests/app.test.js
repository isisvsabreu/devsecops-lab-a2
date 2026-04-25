const request = require('supertest');
const app = require('../src/app');

describe('Health Check', () => {
  it('deve retornar status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /api/info', () => {
  it('deve retornar informações da aplicação', async () => {
    const res = await request(app).get('/api/info');
    expect(res.statusCode).toBe(200);
    expect(res.body.app).toBe('devsecops-lab-a2');
    expect(res.body.version).toBe('1.0.0');
  });
});

describe('POST /api/validate', () => {
  it('deve validar email correto', async () => {
    const res = await request(app)
      .post('/api/validate')
      .send({ email: 'User@Email.COM' });

    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.email).toBe('user@email.com');
  });

  it('deve rejeitar email sem @', async () => {
    const res = await request(app)
      .post('/api/validate')
      .send({ email: 'invalido' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Email inválido');
  });

  it('deve rejeitar body sem email', async () => {
    const res = await request(app)
      .post('/api/validate')
      .send({});

    expect(res.statusCode).toBe(400);
  });
});