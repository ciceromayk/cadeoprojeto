// Termos de uso e privacidade
import { Modal } from './modal.js';

// ---------- LEGAL DOCS ----------
export const LegalDocs = {
  _st: 'margin-bottom:10px;',
  _h: 'color:var(--ink);',
  openPrivacy() {
    Modal.open({ title: 'Política de Privacidade', cls: 'modal-wide', body: `
      <div style="font-size:13px;line-height:1.7;color:var(--ink-soft);max-height:65vh;overflow-y:auto;padding-right:10px;">
        <p style="margin-bottom:4px;color:var(--ink);font-weight:700;font-size:14px;">CadêOProjeto — Política de Privacidade</p>
        <p style="margin-bottom:14px;font-size:11px;font-family:var(--font-mono);color:var(--ink-mute);">Versão 1.1 · Última atualização: 31 de maio de 2026</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">1. Controlador e Encarregado (DPO)</strong><br>
        Controlador: CadêOProjeto, plataforma de titularidade individual. Encarregado de Proteção de Dados (DPO) indicado nos termos do art. 41 da LGPD: contato disponível pelo e-mail <strong>cadeoprojeto@cadeoprojeto.net</strong>. Respostas às solicitações dos titulares serão fornecidas em até 15 (quinze) dias corridos, conforme art. 18, §3º da LGPD.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">2. Dados pessoais coletados</strong><br>
        Coletamos exclusivamente:<br>
        • <strong>Nome completo</strong> e <strong>endereço de e-mail</strong> — fornecidos no cadastro;<br>
        • <strong>Dados de uso</strong> — registros de acesso (IP, data/hora) mantidos pela infraestrutura Supabase Auth para fins de segurança e auditoria;<br>
        • <strong>Dados de projeto</strong> — conteúdo inserido pelo próprio usuário (tarefas, cronogramas, membros de equipe).<br>
        Não coletamos dados sensíveis (art. 5º, II, LGPD), dados bancários, geolocalização, biometria ou dados de menores de 18 anos.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">3. Armazenamento local (localStorage)</strong><br>
        A plataforma utiliza <em>localStorage</em> do navegador para armazenar preferências de interface (tema, configurações de colunas, automações). Esses dados ficam exclusivamente no seu dispositivo, não são transmitidos aos nossos servidores e podem ser removidos a qualquer momento limpando os dados do navegador.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">4. Finalidade e base legal (LGPD — Lei 13.709/2018)</strong><br>
        • <em>Autenticação e acesso:</em> execução do contrato (art. 7º, V);<br>
        • <em>Personalização e preferências:</em> legítimo interesse do controlador (art. 7º, IX);<br>
        • <em>Comunicações sobre a conta:</em> execução do contrato (art. 7º, V);<br>
        • <em>Segurança e prevenção de fraudes:</em> legítimo interesse (art. 7º, IX) e cumprimento de obrigação legal (art. 7º, II).</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">5. Transferência internacional de dados</strong><br>
        Seus dados são processados e armazenados pela <strong>Supabase, Inc.</strong> (infraestrutura em servidores AWS, potencialmente localizados fora do Brasil). Essa transferência ocorre com base no art. 33, II da LGPD, dado que a Supabase adota mecanismos de proteção adequados (criptografia, controles de acesso, conformidade com GDPR/SOC 2). Mais informações: <em>supabase.com/security</em>.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">6. Compartilhamento e não comercialização</strong><br>
        Não vendemos, alugamos, cedemos ou compartilhamos seus dados pessoais com terceiros para fins comerciais ou publicitários. Dados são compartilhados apenas:<br>
        • Com a Supabase, na qualidade de operadora (art. 39, LGPD), para fins de hospedagem e autenticação;<br>
        • Quando exigido por ordem judicial ou autoridade competente.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">7. Seus direitos como titular (LGPD Art. 18)</strong><br>
        Você tem direito a, mediante solicitação ao DPO:<br>
        • <strong>Confirmação e acesso</strong> — saber se tratamos seus dados e acessá-los;<br>
        • <strong>Correção</strong> — atualizar dados em Configurações → Conta;<br>
        • <strong>Anonimização / bloqueio / eliminação</strong> — excluir a conta em Configurações → Zona de Perigo;<br>
        • <strong>Portabilidade</strong> — exportar dados via Configurações → Exportar (JSON);<br>
        • <strong>Informação sobre compartilhamento</strong> — saber com quem seus dados são compartilhados;<br>
        • <strong>Revogação do consentimento</strong> — a qualquer tempo, encerrando a conta;<br>
        • <strong>Reclamação à ANPD</strong> — Autoridade Nacional de Proteção de Dados (gov.br/anpd).</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">8. Segurança técnica e resposta a incidentes</strong><br>
        Adotamos: <em>Row Level Security (RLS)</em> no banco — cada usuário acessa apenas seus próprios dados; <em>HTTPS/TLS</em> em todas as comunicações; senhas gerenciadas exclusivamente pelo Supabase Auth com hash seguro (bcrypt); sem acesso da plataforma às senhas em texto plano.<br><br>
        <strong>Reconhecimento de limitação:</strong> nenhum sistema é absolutamente seguro. A plataforma depende de infraestrutura de terceiros (Supabase, AWS) cujas falhas, ataques ou violações (incluindo ransomware, acesso indevido ou perda de dados) estão fora do controle direto do CadêOProjeto.<br><br>
        <strong>Procedimento de resposta a incidentes (LGPD art. 48):</strong> em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares, o CadêOProjeto: (i) acionará imediatamente a Supabase para contenção; (ii) notificará a ANPD em prazo razoável (preferencialmente em até 72h do conhecimento do incidente); (iii) comunicará os titulares afetados, por e-mail, com a descrição da natureza dos dados afetados, medidas adotadas e recomendações. A notificação não implica reconhecimento de responsabilidade civil.<br><br>
        <strong>Responsabilidade do usuário:</strong> o usuário é responsável pela segurança de suas credenciais de acesso. O compartilhamento de senha, uso em dispositivos comprometidos ou reutilização de senhas em múltiplos serviços é de risco exclusivo do titular.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">9. Retenção dos dados</strong><br>
        Dados são mantidos enquanto a conta estiver ativa. Após exclusão da conta, os dados pessoais e de projeto são removidos de forma definitiva e irreversível, sem possibilidade de recuperação. Logs de segurança da Supabase podem ser retidos por até 90 dias, conforme política da operadora.</p>

        <p style="margin-bottom:0;"><strong style="${LegalDocs._h}">10. Alterações desta Política</strong><br>
        Esta Política pode ser revisada a qualquer tempo. Alterações relevantes serão comunicadas dentro da plataforma com antecedência mínima de 15 dias. O uso continuado após a vigência da nova versão implica aceitação. Para exercer seus direitos ou tirar dúvidas: <strong>cadeoprojeto@cadeoprojeto.net</strong>.</p>
      </div>
    `, footer: `<button class="btn btn-secondary" onclick="Modal.close()">Fechar</button>` });
  },

  openTerms() {
    Modal.open({ title: 'Termos de Uso', cls: 'modal-wide', body: `
      <div style="font-size:13px;line-height:1.7;color:var(--ink-soft);max-height:65vh;overflow-y:auto;padding-right:10px;">
        <p style="margin-bottom:4px;color:var(--ink);font-weight:700;font-size:14px;">CadêOProjeto — Termos de Uso</p>
        <p style="margin-bottom:14px;font-size:11px;font-family:var(--font-mono);color:var(--ink-mute);">Versão 1.1 · Última atualização: 31 de maio de 2026</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">1. Aceitação e capacidade</strong><br>
        Ao criar uma conta ou utilizar o CadêOProjeto, você declara: (a) ter lido, compreendido e aceitado estes Termos e a Política de Privacidade; (b) possuir capacidade civil plena (18 anos ou mais, ou emancipado nos termos do art. 5º, parágrafo único, do Código Civil); (c) ter autoridade para vincular a pessoa jurídica que representa, se aplicável. O uso por menores de 18 anos é vedado sem o consentimento e supervisão de um responsável legal.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">2. Descrição do serviço</strong><br>
        O CadêOProjeto é uma plataforma <em>web</em> de gestão de projetos de engenharia civil, oferecida gratuitamente para uso pessoal e profissional, que inclui funcionalidades de cronograma (Gantt), gestão de tarefas, controle de restrições, RACI, Last Planner e relatórios. A plataforma é fornecida <em>"como está" (as-is)</em>, sem garantia de adequação a finalidade específica, disponibilidade contínua ou ausência de erros.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">3. Licença de uso</strong><br>
        Concedemos ao usuário uma licença pessoal, não exclusiva, intransferível e revogável para acessar e utilizar a plataforma. Todos os direitos de propriedade intelectual sobre a plataforma — código-fonte, design, marca, algoritmos e documentação — são de titularidade exclusiva do CadêOProjeto e permanecem reservados. É vedado: sublicenciar, vender, copiar, modificar, distribuir, realizar engenharia reversa ou criar obras derivadas da plataforma sem autorização prévia e expressa por escrito.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">4. Propriedade e responsabilidade pelos dados inseridos</strong><br>
        Os dados inseridos pelo usuário (projetos, tarefas, membros, documentos) são de sua integral propriedade e responsabilidade. O usuário garante que possui os direitos necessários sobre o conteúdo inserido e que este não viola direitos de terceiros, leis ou regulamentos. O CadêOProjeto não revisa nem se responsabiliza pelo conteúdo inserido pelos usuários.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">5. Uso proibido</strong><br>
        É expressamente vedado ao usuário:<br>
        • Usar a plataforma para fins ilegais, fraudulentos ou prejudiciais a terceiros;<br>
        • Tentar acessar, modificar ou excluir dados de outros usuários;<br>
        • Realizar ataques de força bruta, injeção de código, ou qualquer tentativa de comprometer a segurança da plataforma;<br>
        • Utilizar robôs, scrapers ou mecanismos automatizados não autorizados;<br>
        • Inserir conteúdo ilegal, difamatório, discriminatório ou que viole direitos de terceiros.<br>
        A violação desta cláusula pode acarretar suspensão ou encerramento imediato da conta, sem prejuízo das medidas legais cabíveis.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">6. Disponibilidade e modificações</strong><br>
        A plataforma pode sofrer interrupções programadas ou não, decorrentes de manutenção, atualizações ou falhas de infraestrutura de terceiros (incluindo Supabase/AWS). Nos reservamos o direito de modificar, suspender ou descontinuar funcionalidades a qualquer tempo, com aviso prévio sempre que razoavelmente possível. Recomendamos exportar seus dados regularmente.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">7. Limitação de responsabilidade</strong><br>
        Na máxima extensão permitida pela lei aplicável, o CadêOProjeto não se responsabiliza por:<br>
        • Danos diretos, indiretos, incidentais, consequenciais ou lucros cessantes decorrentes do uso ou impossibilidade de uso da plataforma;<br>
        • Perda, corrupção ou acesso não autorizado a dados causados por falhas de terceiros (provedores de infraestrutura, redes, dispositivos do usuário);<br>
        • Decisões técnicas, financeiras ou gerenciais tomadas com base em informações geradas pela plataforma.<br>
        Em nenhuma hipótese a responsabilidade total do CadêOProjeto, por qualquer causa, excederá o valor pago pelo usuário pelo serviço nos 12 meses anteriores ao evento (ou R$ 0,00, dado que o serviço é gratuito).</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">8. Força maior</strong><br>
        O CadêOProjeto não será responsável por atrasos ou falhas decorrentes de causas fora de seu controle razoável, incluindo, sem limitação: desastres naturais, pandemias, interrupções de energia, falhas de infraestrutura de terceiros, ataques cibernéticos, atos governamentais ou conflitos armados.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">9. Encerramento de conta</strong><br>
        O usuário pode encerrar sua conta a qualquer momento em Configurações → Zona de Perigo. O CadêOProjeto pode suspender ou encerrar contas que violem estes Termos, mediante notificação quando possível e imediatamente em casos de violação grave de segurança ou lei. O encerramento não gera direito a indenização.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">10. Alterações dos Termos</strong><br>
        Estes Termos podem ser revisados. Alterações relevantes serão comunicadas dentro da plataforma com pelo menos 15 dias de antecedência. O uso continuado após a entrada em vigor da nova versão implica aceitação tácita. Caso discorde, o usuário deve encerrar sua conta antes da data de vigência.</p>

        <p style="${LegalDocs._st}"><strong style="${LegalDocs._h}">11. Segurança de dados, incidentes e ransomware</strong><br>
        A plataforma adota medidas técnicas de segurança razoáveis (criptografia em trânsito via HTTPS/TLS, Row Level Security no banco de dados, autenticação segura via Supabase Auth). Contudo, <strong>nenhum sistema de informação é absolutamente imune a falhas, ataques cibernéticos, ransomware, vazamentos de dados ou acesso não autorizado</strong>.<br><br>
        O CadêOProjeto <strong>não garante</strong> e <strong>não se responsabiliza</strong> por:<br>
        • Perda, destruição, corrupção, sequestro ou indisponibilidade de dados causados por ataques cibernéticos de qualquer natureza (ransomware, phishing, DDoS, injeção de código, acesso não autorizado) direcionados à plataforma ou à infraestrutura de terceiros (Supabase, AWS);<br>
        • Vazamento de dados resultante de falha em sistemas de terceiros prestadores de infraestrutura, fora do controle direto do CadêOProjeto;<br>
        • Danos decorrentes do uso de credenciais de acesso comprometidas por negligência, reutilização de senhas ou dispositivos infectados do próprio usuário;<br>
        • Perda de dados causada por exclusão acidental, falha do dispositivo do usuário ou expiração de conta.<br><br>
        <strong>Obrigação de backup:</strong> é de responsabilidade exclusiva do usuário realizar cópias de segurança periódicas dos seus dados por meio da função de <em>backup completo</em> disponível na plataforma (Configurações → Exportar backup completo), que pode ser restaurada a qualquer momento via importação. O CadêOProjeto recomenda fortemente a realização de backups regulares — incluindo o lembrete semanal exibido na plataforma. A ausência de backup não gera qualquer responsabilidade ao CadêOProjeto.<br><br>
        Em caso de incidente de segurança que afete dados pessoais dos usuários, o CadêOProjeto envidará esforços razoáveis para: (i) conter e mitigar o incidente; (ii) notificar os usuários afetados dentro de prazo razoável; (iii) comunicar a Autoridade Nacional de Proteção de Dados (ANPD) quando exigido por lei. Tais medidas não implicam reconhecimento de responsabilidade civil ou criminal pelo incidente.</p>

        <p style="margin-bottom:0;"><strong style="${LegalDocs._h}">12. Lei aplicável e foro</strong><br><!-- cláusula renumerada -->
        Estes Termos são regidos exclusivamente pelas leis da República Federativa do Brasil, em especial o Código Civil (Lei 10.406/2002), o Marco Civil da Internet (Lei 12.965/2014), a LGPD (Lei 13.709/2018) e o CDC (Lei 8.078/1990) quando aplicável. Fica eleito o <strong>foro da comarca de domicílio do usuário</strong>, nos termos do art. 22, II, do CPC, para dirimir quaisquer controvérsias decorrentes destes Termos, renunciando-se a qualquer outro por mais privilegiado que seja.</p>
      </div>
    `, footer: `<button class="btn btn-secondary" onclick="Modal.close()">Fechar</button>` });
  }
};
