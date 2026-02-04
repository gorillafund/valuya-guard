class ValuyaConfigError(Exception):
    pass

class ValuyaHttpError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status
