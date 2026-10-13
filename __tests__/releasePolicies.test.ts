import { LEGAL_CONTENT } from '../src/constants/LegalContent';

describe('Restricted pilot policy truthfulness', () => {
  it('identifies the confirmed operator and does not promise live money movement', () => {
    expect(LEGAL_CONTENT.TERMS_OF_SERVICE).toContain('PAPZ (Pty) Ltd (registration 2025/188861/07)');
    expect(LEGAL_CONTENT.TERMS_OF_SERVICE).toContain('disabled for general use in the pilot');
    expect(LEGAL_CONTENT.TERMS_OF_SERVICE).toContain('not deducted from Talent');
    expect(LEGAL_CONTENT.TERMS_OF_SERVICE).not.toContain('full refund less 10% admin fee');
    expect(LEGAL_CONTENT.CREATOR_POLICY).not.toContain('R250 admin fee');
  });

  it('does not advertise adult areas or imply automatic model-release signatures', () => {
    expect(LEGAL_CONTENT.TERMS_OF_SERVICE).toContain('no adult-content area');
    expect(LEGAL_CONTENT.CREATOR_POLICY).toContain('sexually explicit content and sexual services are prohibited');
    expect(LEGAL_CONTENT.MODEL_RELEASE).toContain('does not record signatures or consent');
    expect(LEGAL_CONTENT.MODEL_RELEASE).not.toContain('By accepting a booking, both parties agree');
  });

  it('uses the configured support address and current regulator contact', () => {
    expect(LEGAL_CONTENT.PRIVACY_POLICY).toContain('support@papzii.co.za');
    expect(LEGAL_CONTENT.PRIVACY_POLICY).toContain('POPIAComplaints@inforegulator.org.za');
    expect(LEGAL_CONTENT.PRIVACY_POLICY).not.toContain('inforeg@justice.gov.za');
  });
});
