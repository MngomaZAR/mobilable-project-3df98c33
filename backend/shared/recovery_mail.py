import smtplib
import ssl
from email.message import EmailMessage

from cryptography.fernet import Fernet


def encrypt_reset_token(key: str, token: str) -> str:
    return Fernet(key.encode()).encrypt(token.encode()).decode()


def decrypt_reset_token(key: str, encrypted: str) -> str:
    return Fernet(key.encode()).decrypt(encrypted.encode(), ttl=1800).decode()


def send_reset_email(config, email: str, token: str) -> None:
    message = EmailMessage()
    message['From'] = config['SMTP_FROM']
    message['To'] = email
    message['Subject'] = 'Reset your PAPZII password'
    message.set_content(
        'A password reset was requested for your PAPZII account.\n\n'
        f'Reset code: {token}\n\n'
        'Open PAPZII, choose Forgot password then Enter reset code. '
        'This code expires in 30 minutes and can only be used once. '
        'If you did not request it, ignore this email. Do not share this code.'
    )
    context = ssl.create_default_context()
    use_ssl = str(config.get('SMTP_SSL', 'false')).lower() == 'true'
    client_type = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    kwargs = {'context': context} if use_ssl else {}
    with client_type(config['SMTP_HOST'], int(config.get('SMTP_PORT', 465 if use_ssl else 587)), timeout=15, **kwargs) as smtp:
        if not use_ssl:
            smtp.starttls(context=context)
        smtp.login(config['SMTP_USER'], config['SMTP_PASSWORD'])
        smtp.send_message(message)
