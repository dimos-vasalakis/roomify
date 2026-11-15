"""Prices in plain words, in the shop's own currency."""

SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£", "JPY": "¥", "INR": "₹"}


def money(amount: float, currency: str = "EUR") -> str:
    """money(19.9, 'USD') -> '$19.90'; unknown currencies keep their code: '25 CHF'."""
    text = f"{amount:,.2f}".removesuffix(".00")
    symbol = SYMBOLS.get(currency.upper())
    return f"{symbol}{text}" if symbol else f"{text} {currency.upper()}"
