class Oven():

    def __init__(self, model, version):
        self.model = model
        self.version = version

    def __str__(self):
        return 'Model: ' + self.model + '\nVersion: ' + self.version
